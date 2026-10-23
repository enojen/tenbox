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
import { git } from "../infra/git.ts";
import { shell } from "../infra/shell.ts";

/** The failure lines a check already has at the base commit. */
export const baselines = { find };

interface BaselineHit extends Baseline {
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

/** The stored baseline for the base commit, else the newest stored one, else one taken in main. */
async function find(request: BaselineRequest): Promise<BaselineHit | null> {
  const key = { project: request.project.name, check: request.check };
  const stored = await findStored(key, request.baseSha);
  if (stored) return stored;
  const canTake = await canTakeInMain(request);
  if (!canTake) return null;
  return takeBaseline(key, request);
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

async function takeBaseline(key: BaselineKey, request: BaselineRequest): Promise<BaselineHit> {
  const { project, check, cmd, baseSha, timeoutMs, pattern } = request;
  log(
    `tenbox check: ${check}: no baseline for ${shortSha(baseSha)}, taking one in ${project.mainDir}`,
  );
  const ran = await shell.run(cmd, { cwd: project.mainDir, timeoutMs });
  const exitCode = shell.exitCode(ran);
  const lines = parseFailures(ran.output, exitCode, pattern);
  const meta = { date: new Date().toISOString(), cmd, exit_code: exitCode };
  await baselineStore.save(key, { sha: baseSha, lines }, meta);
  return { sha: baseSha, lines, source: BASELINE_SOURCE.main };
}
