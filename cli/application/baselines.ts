import {
  BASELINE_SOURCE,
  type Baseline,
  type BaselineSource,
  parseFailures,
} from "../../domain/failures.ts";
import { shortSha } from "../../domain/ids.ts";
import type { Project } from "../../domain/projects.ts";
import { type BaselineKey, baselineStore } from "../infra/baselineStore.ts";
import { log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { shell } from "../infra/shell.ts";
import { setups } from "./setups.ts";

/** The failure lines a check already has at the base commit. */
export const baselines = { find, takeAtBase };

const TEMP_PREFIX = "tenbox-baseline-";

export interface BaselineHit extends Baseline {
  source: BaselineSource;
}

interface BaselineRequest {
  project: Project;
  taskWorktree: string;
  check: string;
  cmd: string;
  baseSha: string;
  pattern: string;
  timeoutMs: number;
}

interface BaseRequest extends BaselineRequest {
  /** The manifest's `setup`, run in the temporary worktree first. */
  setup: string | undefined;
}

/** The stored baseline for the base commit, else the newest stored one, else one taken in main. */
async function find(request: BaselineRequest): Promise<BaselineHit | null> {
  const key = { project: request.project.name, check: request.check };
  const stored = await findStored(key, request.baseSha);
  if (stored) return stored;
  const canTake = await canTakeInMain(request);
  if (!canTake) return null;
  const { project, check, baseSha } = request;
  log(
    `tenbox check: ${check}: no baseline for ${shortSha(baseSha)}, taking one in ${project.mainDir}`,
  );
  return takeIn(project.mainDir, request, BASELINE_SOURCE.main);
}

/**
 * Runs the check at the base commit in a temporary worktree, after `setup`, and saves the result
 * as the baseline of that commit. The worktree is removed on every way out.
 */
async function takeAtBase(request: BaseRequest): Promise<BaselineHit> {
  const { project, check, baseSha, setup } = request;
  log(
    `tenbox check: ${check}: taking the baseline of ${shortSha(baseSha)} in a temporary worktree`,
  );
  const dir = await files.makeTempDir(TEMP_PREFIX);
  try {
    await git.addDetachedWorktree(project.mainDir, dir, baseSha);
    await setups.run(dir, setup, true);
    return await takeIn(dir, request, BASELINE_SOURCE.base);
  } finally {
    await files.remove(dir);
    await git.pruneWorktrees(project.mainDir);
  }
}

async function findStored(key: BaselineKey, sha: string): Promise<BaselineHit | null> {
  const exact = await baselineStore.find(key, sha);
  if (exact) return { ...exact, source: BASELINE_SOURCE.exact };
  const newest = await baselineStore.findNewest(key);
  return newest ? { ...newest, source: BASELINE_SOURCE.newest } : null;
}

/** Main must sit at the base commit, and the check must not already run in main. */
async function canTakeInMain(request: BaselineRequest): Promise<boolean> {
  const { project, taskWorktree, baseSha } = request;
  if (project.mainDir === taskWorktree) return false;
  const mainHead = await git.findHead(project.mainDir);
  return mainHead === baseSha;
}

async function takeIn(
  cwd: string,
  request: BaselineRequest,
  source: BaselineSource,
): Promise<BaselineHit> {
  const { project, check, cmd, baseSha, timeoutMs, pattern } = request;
  const ran = await shell.run(cmd, { cwd, timeoutMs });
  const exitCode = shell.exitCode(ran);
  const lines = parseFailures(ran.output, exitCode, pattern);
  const meta = { date: new Date().toISOString(), cmd, exit_code: exitCode };
  await baselineStore.save({ project: project.name, check }, { sha: baseSha, lines }, meta);
  return { sha: baseSha, lines, source };
}
