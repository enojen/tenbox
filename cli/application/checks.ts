import { type CheckOutcome, type CheckResult, readCheckResult } from "../../domain/checks.ts";
import { compareWithBaseline, findFlaky, parseFailures } from "../../domain/failures.ts";
import type { Project } from "../../domain/projects.ts";
import { roundNumbers } from "../../domain/rounds.ts";
import { checksFile, roundDir, roundsDir } from "../../domain/taskDirs.ts";
import { elapsedMs } from "../infra/clock.ts";
import { log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { type ShellResult, shell } from "../infra/shell.ts";
import { baselines } from "./baselines.ts";

/**
 * One check run and judged: only failures the base commit did not have count. `find` reads what
 * `tenbox check` wrote to a round.
 */
export const checks = { run, summarize, find, findLatest };

interface CheckRequest {
  project: Project;
  /** Where the command runs. */
  cwd: string;
  name: string;
  cmd: string;
  pattern: string;
  baseSha: string;
  timeoutMs: number;
}

interface CheckRunResult {
  outcome: CheckOutcome;
  /** The raw output of the command, for the caller's log file. */
  output: string;
}

async function run(request: CheckRequest): Promise<CheckRunResult> {
  const { name, cmd, cwd, pattern, baseSha, timeoutMs } = request;
  log(`tenbox check: ${name}: ${cmd}`);
  const started = performance.now();
  const first = await shell.run(cmd, { cwd, timeoutMs });
  const hit = await baselines.find({ ...request, taskWorktree: cwd, check: name });
  const firstFailures = parseFailures(first.output, shell.exitCode(first), pattern);
  const firstJudged = compareWithBaseline(hit?.lines ?? [], firstFailures);
  const second = await rerunWhenNew({ request, newCount: firstJudged.newFailures.length });
  const last = second ?? first;
  const exitCode = shell.exitCode(last);
  const durationMs = elapsedMs(started);
  const current = second ? parseFailures(second.output, exitCode, pattern) : firstFailures;
  const { newFailures, fixed } = compareWithBaseline(hit?.lines ?? [], current);
  const flaky = findFlaky(firstJudged.newFailures, newFailures);
  log(
    `tenbox check: ${name}: ${current.length} failures, ${newFailures.length} new, ${flaky.length} flaky, ${fixed.length} fixed (${durationMs} ms)`,
  );
  const outcome: CheckOutcome = {
    name,
    cmd,
    exit_code: exitCode,
    duration_ms: durationMs,
    timed_out: last.timedOut,
    failures: current.length,
    new_failures: newFailures,
    flaky,
    fixed,
    baseline: {
      sha: hit?.sha ?? baseSha,
      source: hit?.source ?? "none",
      failures: hit?.lines.length ?? 0,
    },
  };
  return {
    outcome,
    output: second ? `${first.output}\n--- rerun ---\n${second.output}` : first.output,
  };
}

interface RerunRequest {
  request: CheckRequest;
  newCount: number;
}

/** One more run when the first had new failures; a green check costs nothing extra. */
function rerunWhenNew(rerun: RerunRequest): Promise<ShellResult | null> {
  const { request, newCount } = rerun;
  if (newCount === 0) return Promise.resolve(null);
  log(`tenbox check: ${request.name}: ${newCount} new, running it once more`);
  return shell.run(request.cmd, { cwd: request.cwd, timeoutMs: request.timeoutMs });
}

function summarize(outcomes: CheckOutcome[]): string {
  const failing = outcomes.filter((r) => r.new_failures.length > 0);
  const flaky = outcomes.filter((r) => r.flaky.length > 0).map(describeFlaky);
  const head =
    failing.length === 0
      ? [`all ${outcomes.length} check(s) pass with no new failures`]
      : failing.map(describeNewFailures);
  return [...head, ...flaky].join("\n");
}

function describeNewFailures(outcome: CheckOutcome): string {
  const lines = outcome.new_failures.map((line) => `  ${line}`).join("\n");
  return `${outcome.name}: ${outcome.new_failures.length} new failure(s)\n${lines}`;
}

function describeFlaky(outcome: CheckOutcome): string {
  const lines = outcome.flaky.map((line) => `  ${line}`).join("\n");
  return `${outcome.name}: ${outcome.flaky.length} flaky (failed once, passed on the rerun)\n${lines}`;
}

/** The check result in `file`; null when it is missing, `bad-file` when it is not valid. */
async function find(file: string): Promise<CheckResult | null> {
  const text = await files.read(file);
  return text === null ? null : readCheckResult(text, file);
}

async function findLatest(roundsRoot: string): Promise<CheckResult | null> {
  const names = await files.list(roundsDir(roundsRoot));
  for (const round of roundNumbers(names).reverse()) {
    const result = await find(checksFile(roundDir(roundsRoot, round)));
    if (result !== null) return result;
  }
  return null;
}
