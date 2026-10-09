import path from "node:path";
import { noHeadError } from "../../domain/errors/git.ts";
import { noBaseError } from "../../domain/errors/index.ts";
import { noChecksError } from "../../domain/errors/manifest.ts";
import type { TaskId } from "../../domain/ids.ts";
import type { Project } from "../../domain/project.ts";
import { checksFile, nextRound, roundDir, roundsDir, tenboxDir } from "../../domain/task.ts";
import { checks } from "../application/checks.ts";
import { manifests } from "../application/manifests.ts";
import { projects } from "../application/projects.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import type { CheckResult, CheckRun } from "./results.ts";

export interface CheckInput {
  id: TaskId;
  round: number | undefined;
  /** Default: the manifest's `base`. */
  base: string | undefined;
  timeoutMs: number;
}

/** Everything one round shares across its checks. */
interface Round {
  number: number;
  dir: string;
  taskWorktree: string;
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

/**
 * Runs every check in the task worktree and keeps only failures the base commit did
 * not already have: the devbox `wtbase` algorithm. Writes `.tenbox/rounds/N/checks.json`.
 */
export async function runChecks(input: CheckInput): Promise<CheckResult> {
  const round = await prepareRound(input);
  const results: CheckRun[] = [];
  for (const [name, cmd] of Object.entries(round.checks)) {
    const run = await runCheck(round, { name, cmd });
    results.push(run);
  }
  const result = buildResult(input, round, results);
  await files.writeJson(checksFile(round.dir), result);
  return result;
}

async function prepareRound(input: CheckInput): Promise<Round> {
  const taskWorktree = await worktrees.get(input.id);
  const { project, manifest } = await projects.get(taskWorktree);
  const base = input.base ?? manifest.base;
  const setup = await getChecks(project.mainDir, taskWorktree);
  const { number, dir } = await ensureRound(taskWorktree, input.round);
  const { head, baseSha } = await getCommits(taskWorktree, base);
  const timeoutMs = input.timeoutMs;
  return { number, dir, taskWorktree, project, ...setup, head, base, baseSha, timeoutMs };
}

/** Tenbox runs only what the manifest says; it does not guess from the project. */
async function getChecks(mainDir: string, taskWorktree: string): Promise<CheckSetup> {
  const manifest = await manifests.get(mainDir, taskWorktree);
  if (Object.keys(manifest.checks).length === 0) {
    throw noChecksError();
  }
  return { checks: manifest.checks, pattern: manifest.failure_pattern ?? env().failurePattern };
}

/** The wanted round, else the next free one; creates its `checks/` directory. */
async function ensureRound(taskWorktree: string, wanted?: number): Promise<RoundDir> {
  const existing = await files.list(roundsDir(tenboxDir(taskWorktree)));
  const number = wanted ?? nextRound(existing);
  const dir = roundDir(tenboxDir(taskWorktree), number);
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
  const { project, taskWorktree, pattern, baseSha, timeoutMs } = round;
  const request = { ...check, project, cwd: taskWorktree, pattern, baseSha, timeoutMs };
  const { outcome, output } = await checks.run(request);
  const logFile = path.join(round.dir, "checks", `${check.name}.log`);
  await files.write(logFile, output);
  return { ...outcome, log: path.relative(taskWorktree, logFile) };
}

function buildResult(input: CheckInput, round: Round, results: CheckRun[]): CheckResult {
  return {
    ok: results.every((r) => r.new_failures.length === 0),
    task: input.id,
    round: round.number,
    worktree: round.taskWorktree,
    commit: round.head,
    base: { ref: round.base, sha: round.baseSha },
    checks: results,
    summary: checks.summarize(results),
    file: path.relative(round.taskWorktree, checksFile(round.dir)),
  };
}
