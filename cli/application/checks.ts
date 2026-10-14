import { compareWithBaseline, parseFailures } from "../../domain/failures.ts";
import type { Project } from "../../domain/project.ts";
import { elapsedMs } from "../../domain/utils.ts";
import type { CheckOutcome } from "../commands/results.ts";
import { log } from "../infra/env.ts";
import { shell } from "../infra/shell.ts";
import { baselines } from "./baselines.ts";

/** One check run and judged: only failures the base commit did not have count. */
export const checks = { run, summarize };

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
  const ran = await shell.run(cmd, { cwd, timeoutMs });
  const durationMs = elapsedMs(started);
  const exitCode = shell.exitCode(ran);
  const current = parseFailures(ran.output, exitCode, pattern);
  const hit = await baselines.find({ ...request, taskWorktree: cwd, check: name });
  const { newFailures, fixed } = compareWithBaseline(hit?.lines ?? [], current);
  log(
    `tenbox check: ${name}: ${current.length} failures, ${newFailures.length} new, ${fixed.length} fixed (${durationMs} ms)`,
  );
  const outcome: CheckOutcome = {
    name,
    cmd,
    exit_code: exitCode,
    duration_ms: durationMs,
    timed_out: ran.timedOut,
    failures: current.length,
    new_failures: newFailures,
    fixed,
    baseline: {
      sha: hit?.sha ?? baseSha,
      source: hit?.source ?? "none",
      failures: hit?.lines.length ?? 0,
    },
  };
  return { outcome, output: ran.output };
}

function summarize(outcomes: CheckOutcome[]): string {
  const failing = outcomes.filter((r) => r.new_failures.length > 0);
  if (failing.length === 0) return `all ${outcomes.length} check(s) pass with no new failures`;
  return failing.map(describeNewFailures).join("\n");
}

function describeNewFailures(outcome: CheckOutcome): string {
  const lines = outcome.new_failures.map((line) => `  ${line}`).join("\n");
  return `${outcome.name}: ${outcome.new_failures.length} new failure(s)\n${lines}`;
}
