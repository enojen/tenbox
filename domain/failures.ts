import { z } from "zod";
import { lists, strings } from "./utils.ts";

/** vitest/jest `FAIL × ✕ ✗`, bun `(fail)`, tsc `error TS1234`: the devbox `wtbase` default. */
export const DEFAULT_FAILURE_PATTERN = "(^|\\s)(FAIL|\\(fail\\)|×|✕|✗)(\\s|$)|error TS[0-9]+";

/** `[8.00ms]` (bun), `in 3s` (gradle): durations differ on every run. */
const TRAILING_DURATION = /(\s*\[\d+(\.\d+)?m?s\]|\s+in\s+\d+(\.\d+)?m?s)$/;

/** `src/a.ts(10,5): error TS2322` (tsc): the position moves when a line is added above it. */
const TSC_POSITION = /\(\d+,\d+\)(?=: error TS\d+)/;

/** Long enough for a stack trace head, short enough for a PR body. */
const MAX_REASON_LENGTH = 200;

/** A line of check output in our format, so two of them compare by `===`. Made only by `failureLine`. */
export type FailureLine = string & { readonly __brand: "FailureLine" };

/** No colours, no outer spaces, no duration, no tsc position: the same failure looks the same on every run. */
export function failureLine(raw: string): FailureLine {
  return Bun.stripANSI(raw)
    .trim()
    .replace(TRAILING_DURATION, "")
    .replace(TSC_POSITION, "") as FailureLine;
}

/** The failures `main` already has at commit `sha`. A task is only blamed for failures not in here. */
/** Where a check's baseline came from: the base commit, the newest stored, taken in main, or none. */
export const BASELINE_SOURCE = {
  exact: "exact",
  newest: "newest",
  main: "main",
  none: "none",
} as const;

export const BaselineSourceSchema = z.enum(BASELINE_SOURCE);
export type BaselineSource = (typeof BASELINE_SOURCE)[keyof typeof BASELINE_SOURCE];

export interface Baseline {
  sha: string;
  lines: FailureLine[];
}

export interface FailureComparison {
  /** The only thing that fails a check. */
  newFailures: FailureLine[];
  fixed: FailureLine[];
}

/** A failing exit with no matching line still yields one line, so a crash cannot pass silently. */
export function parseFailures(
  commandOutput: string,
  exitCode: number,
  failurePattern = DEFAULT_FAILURE_PATTERN,
): FailureLine[] {
  const lines = commandOutput.split("\n").map(failureLine);
  const matched = lines.filter(isFailureLine(failurePattern));
  const failures = lists.unique(matched).sort();
  if (isCrash(failures, exitCode)) return [buildCrashFailure(lines, exitCode)];
  return failures;
}

export function compareWithBaseline(
  baseline: FailureLine[],
  current: FailureLine[],
): FailureComparison {
  const inBaseline = new Set(baseline);
  const inCurrent = new Set(current);
  return {
    newFailures: current.filter((line) => !inBaseline.has(line)),
    fixed: baseline.filter((line) => !inCurrent.has(line)),
  };
}

/** A new failure of the first run that the rerun did not repeat. */
export function findFlaky(firstNew: FailureLine[], rerunNew: FailureLine[]): FailureLine[] {
  const repeated = new Set(rerunNew);
  return firstNew.filter((line) => !repeated.has(line));
}

function isFailureLine(failurePattern: string): (line: FailureLine) => boolean {
  const re = new RegExp(failurePattern);
  return (line) => re.test(line);
}

function isCrash(failures: FailureLine[], exitCode: number): boolean {
  return failures.length === 0 && exitCode !== 0;
}

function buildCrashFailure(lines: FailureLine[], exitCode: number): FailureLine {
  const reason = strings.lastNonEmptyLine(lines);
  if (reason === undefined) return failureLine(`exit ${exitCode}`);
  return failureLine(`exit ${exitCode}: ${reason.slice(0, MAX_REASON_LENGTH)}`);
}
