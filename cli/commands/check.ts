import path from "node:path";
import { noBaseError, TenboxError } from "../../domain/errors/index.ts";
import { compareWithBaseline, parseFailures } from "../../domain/failures.ts";
import type { TaskId } from "../../domain/ids.ts";
import type { Project } from "../../domain/project.ts";
import { nextRound, roundDir, tenboxDir } from "../../domain/task.ts";
import { elapsedMs } from "../../domain/utils.ts";
import { env, log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { type ShellResult, shell } from "../infra/shell.ts";
import { type BaselineHit, baselines } from "../application/baselines.ts";
import { manifests } from "../application/manifests.ts";
import { projects } from "../application/projects.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { BaselineSummary, CheckResult, CheckRun } from "./results.ts";

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

interface ExecutedCheck extends NamedCheck {
  ran: ShellResult;
  durationMs: number;
  logFile: string;
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
  await files.write(path.join(round.dir, "checks.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function prepareRound(input: CheckInput): Promise<Round> {
  const taskWorktree = await worktrees.get(input.id);
  const { project, manifest } = await projects.get(taskWorktree);
  const base = input.base ?? manifest.base;
  const { checks, pattern } = await getChecks(project.mainDir, taskWorktree);
  const { number, dir } = await ensureRound(taskWorktree, input.round);
  const { head, baseSha } = await getCommits(taskWorktree, base);
  const timeoutMs = input.timeoutMs;
  return { number, dir, taskWorktree, project, checks, pattern, head, base, baseSha, timeoutMs };
}

/** Tenbox runs only what the manifest says; it does not guess from the project. */
async function getChecks(mainDir: string, taskWorktree: string): Promise<CheckSetup> {
  const manifest = await manifests.get(mainDir, taskWorktree);
  if (Object.keys(manifest.checks).length === 0) {
    throw new TenboxError("no checks: in tenbox.yaml; add one", "no-checks");
  }
  return { checks: manifest.checks, pattern: manifest.failure_pattern ?? env().failurePattern };
}

/** The wanted round, else the next free one; creates its `checks/` directory. */
async function ensureRound(taskWorktree: string, wanted?: number): Promise<RoundDir> {
  const existing = await files.list(path.join(tenboxDir(taskWorktree), "rounds"));
  const number = wanted ?? nextRound(existing);
  const dir = roundDir(taskWorktree, number);
  await files.mkdir(path.join(dir, "checks"));
  return { number, dir };
}

async function getCommits(taskWorktree: string, base: string): Promise<Commits> {
  const head = await git.findHead(taskWorktree);
  if (head === null) {
    throw new TenboxError(`${taskWorktree} has no commit yet; commit first`, "no-head");
  }
  const baseExists = await git.refExists(taskWorktree, `${base}^{commit}`);
  if (!baseExists) throw noBaseError(base, "not found");
  const baseSha = await git.findMergeBase(taskWorktree, base);
  if (baseSha === null) throw noBaseError(base, "has no common ancestor with HEAD");
  return { head, baseSha };
}

async function runCheck(round: Round, check: NamedCheck): Promise<CheckRun> {
  const executed = await executeCheck(round, check);
  return judgeCheck(round, executed);
}

async function executeCheck(round: Round, check: NamedCheck): Promise<ExecutedCheck> {
  log(`tenbox check: ${check.name}: ${check.cmd}`);
  const started = performance.now();
  const ran = await shell.run(check.cmd, { cwd: round.taskWorktree, timeoutMs: round.timeoutMs });
  const durationMs = elapsedMs(started);
  const logFile = path.join(round.dir, "checks", `${check.name}.log`);
  await files.write(logFile, ran.output);
  return { ...check, ran, durationMs, logFile };
}

async function judgeCheck(round: Round, executed: ExecutedCheck): Promise<CheckRun> {
  const { name, cmd, ran, durationMs } = executed;
  const exitCode = shell.exitCode(ran);
  const current = parseFailures(ran.output, exitCode, round.pattern);
  const hit = await baselines.find({ ...round, check: name, cmd });
  const { newFailures, fixed } = compareWithBaseline(hit?.lines ?? [], current);
  log(
    `tenbox check: ${name}: ${current.length} failures, ${newFailures.length} new, ${fixed.length} fixed (${durationMs} ms)`,
  );
  return {
    name,
    cmd,
    exit_code: exitCode,
    duration_ms: durationMs,
    timed_out: ran.timedOut,
    failures: current.length,
    new_failures: newFailures,
    fixed,
    baseline: summarizeBaseline(hit, round.baseSha),
    log: path.relative(round.taskWorktree, executed.logFile),
  };
}

function summarizeBaseline(hit: BaselineHit | null, baseSha: string): BaselineSummary {
  return {
    sha: hit?.sha ?? baseSha,
    source: hit?.source ?? "none",
    failures: hit?.lines.length ?? 0,
  };
}

function summarize(results: CheckRun[]): string {
  const failing = results.filter((r) => r.new_failures.length > 0);
  if (failing.length === 0) return `all ${results.length} check(s) pass with no new failures`;
  return failing.map(describeNewFailures).join("\n");
}

function describeNewFailures(run: CheckRun): string {
  const lines = run.new_failures.map((line) => `  ${line}`).join("\n");
  return `${run.name}: ${run.new_failures.length} new failure(s)\n${lines}`;
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
    summary: summarize(results),
    file: path.relative(round.taskWorktree, path.join(round.dir, "checks.json")),
  };
}
