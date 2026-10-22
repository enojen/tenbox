import path from "node:path";
import { buildFile } from "../../domain/build.ts";
import type { CheckResult, CheckRun } from "../../domain/check.ts";
import { noHeadError } from "../../domain/errors/git.ts";
import { noBaseError } from "../../domain/errors/index.ts";
import { noChecksError } from "../../domain/errors/manifest.ts";
import type { TaskId } from "../../domain/ids.ts";
import { CHECK_TIER, type CheckTier } from "../../domain/manifest.ts";
import { NOTIFICATION_STATE } from "../../domain/notifications.ts";
import type { Project } from "../../domain/project.ts";
import {
  checksFile,
  checksFullFile,
  currentRound,
  groupDir,
  nextRound,
  roundDir,
  roundsDir,
  tenboxDir,
} from "../../domain/task.ts";
import { checks } from "../application/checks.ts";
import { groups } from "../application/groups.ts";
import { manifests } from "../application/manifests.ts";
import { notifications, type TaskNotification } from "../application/notifications.ts";
import { projects } from "../application/projects.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";

export interface CheckInput {
  id: TaskId;
  group: number | undefined;
  round: number | undefined;
  tier: CheckTier;
  /** Default: the manifest's `base`. */
  base: string | undefined;
  timeoutMs: number;
}

/** Everything one round shares across its checks. */
interface Round {
  id: TaskId;
  number: number;
  dir: string;
  tier: CheckTier;
  taskWorktree: string;
  cwd: string;
  project: Project;
  checks: Record<string, string>;
  pattern: string;
  head: string;
  base: string;
  baseSha: string;
  timeoutMs: number;
}

interface CheckSetup {
  checks: Record<string, string>;
  pattern: string;
}

interface RoundDir {
  number: number;
  dir: string;
}

interface Commits {
  head: string;
  baseSha: string;
}

interface NamedCheck {
  name: string;
  cmd: string;
}

const RESULT_FILES: Record<CheckTier, (roundDir: string) => string> = {
  fast: checksFile,
  full: checksFullFile,
};

/**
 * Runs every check of the tier in the task worktree and keeps only failures the base commit did
 * not already have: the devbox `wtbase` algorithm. Writes `.tenbox/rounds/N/checks.json`, or
 * `checks-full.json` for the `full` tier.
 */
export async function runChecks(input: CheckInput): Promise<CheckResult> {
  const round = await prepareRound(input);
  const results: CheckRun[] = [];
  for (const [name, cmd] of Object.entries(round.checks)) {
    const run = await runCheck(round, { name, cmd });
    results.push(run);
  }
  const result = buildResult(input, round, results);
  await files.writeJson(RESULT_FILES[round.tier](round.dir), result);
  if (!result.ok) await notifyFailed(round, results);
  return result;
}

/** The build goes on while there is no `build.json`: the workflow feeds the failures to the next round. */
async function notifyFailed(round: Round, results: CheckRun[]): Promise<void> {
  const failing = results.filter((run) => run.new_failures.length > 0);
  const count = failing.reduce((sum, run) => sum + run.new_failures.length, 0);
  const finished = await files.exists(buildFile(tenboxDir(round.taskWorktree)));
  const what = `${failing.map((run) => run.name).join(", ")}: ${count} new failure(s), round ${round.number}`;
  const notification: TaskNotification = {
    id: round.id,
    state: NOTIFICATION_STATE.checkFailed,
    detail: finished ? what : `${what}, the build goes on`,
  };
  await notifications.send({ taskWorktree: round.taskWorktree, notification });
}

async function prepareRound(input: CheckInput): Promise<Round> {
  const taskWorktree = await worktrees.get(input.id);
  const { project, manifest } = await projects.get(taskWorktree);
  const base = input.base ?? manifest.base;
  const group = input.group ?? 1;
  const { worktree: cwd } = await groups.ensure({
    id: input.id,
    group,
    project,
    manifest,
    taskWorktree,
  });
  const setup = await getChecks(project.mainDir, taskWorktree, input.tier);
  const roundsRoot =
    group === 1 ? tenboxDir(taskWorktree) : groupDir(tenboxDir(taskWorktree), group);
  const { number, dir } = await ensureRound(roundsRoot, input);
  const { head, baseSha } = await getCommits(cwd, base);
  const timeoutMs = input.timeoutMs;
  return {
    id: input.id,
    number,
    dir,
    tier: input.tier,
    taskWorktree,
    cwd,
    project,
    ...setup,
    head,
    base,
    baseSha,
    timeoutMs,
  };
}

/** Tenbox runs only what the manifest says; it does not guess from the project. */
async function getChecks(
  mainDir: string,
  taskWorktree: string,
  tier: CheckTier,
): Promise<CheckSetup> {
  const manifest = await manifests.get(mainDir, taskWorktree);
  const { fast, full } = manifest.checks;
  if (Object.keys(fast).length + Object.keys(full).length === 0) {
    throw noChecksError();
  }
  return {
    checks: manifest.checks[tier],
    pattern: manifest.failure_pattern ?? env().failurePattern,
  };
}

/**
 * The wanted round, else a new one for `fast` and the current one for `full`, which closes a
 * round; creates its `checks/` directory.
 */
async function ensureRound(roundsRoot: string, input: CheckInput): Promise<RoundDir> {
  const existing = await files.list(roundsDir(roundsRoot));
  const fallback = input.tier === CHECK_TIER.full ? currentRound(existing) : nextRound(existing);
  const number = input.round ?? fallback;
  const dir = roundDir(roundsRoot, number);
  await files.mkdir(path.join(dir, "checks"));
  return { number, dir };
}

async function getCommits(taskWorktree: string, base: string): Promise<Commits> {
  const head = await git.findHead(taskWorktree);
  if (head === null) {
    throw noHeadError(taskWorktree);
  }
  const baseExists = await git.refExists(taskWorktree, `${base}^{commit}`);
  if (!baseExists) throw noBaseError(base, "not found");
  const baseSha = await git.findMergeBase(taskWorktree, base);
  if (baseSha === null) throw noBaseError(base, "has no common ancestor with HEAD");
  return { head, baseSha };
}

async function runCheck(round: Round, check: NamedCheck): Promise<CheckRun> {
  const { project, cwd, pattern, baseSha, timeoutMs } = round;
  const request = { ...check, project, cwd, pattern, baseSha, timeoutMs };
  const { outcome, output } = await checks.run(request);
  const logFile = path.join(round.dir, "checks", `${check.name}.log`);
  await files.write(logFile, output);
  return { ...outcome, log: path.relative(round.taskWorktree, logFile) };
}

function buildResult(input: CheckInput, round: Round, results: CheckRun[]): CheckResult {
  return {
    ok: results.every((r) => r.new_failures.length === 0),
    task: input.id,
    round: round.number,
    worktree: round.cwd,
    commit: round.head,
    base: { ref: round.base, sha: round.baseSha },
    checks: results,
    summary: checks.summarize(results),
    file: path.relative(round.taskWorktree, RESULT_FILES[round.tier](round.dir)),
    tier: round.tier,
  };
}
