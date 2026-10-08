import type { BaselineSource } from "../../domain/failures.ts";
import type { TrackerKind } from "../../domain/manifest.ts";

/* Command outputs: the shape of the one JSON document each command prints. */

export type SetupResult =
  | { state: "ran"; cmd: string; exit_code: number; duration_ms: number }
  | { state: "skipped"; reason: string };

export type TmuxState = "started" | "exists" | "skipped" | "unavailable";

export interface TmuxInfo {
  session: string;
  state: TmuxState;
  attach: string;
}

export interface TrackerInfo {
  kind: TrackerKind;
  status: string;
}

export interface StartResult {
  ok: true;
  task: string;
  title: string;
  project: string;
  worktree: string;
  branch: string;
  base: string;
  created: boolean;
  task_md: string;
  setup: SetupResult;
  tracker: TrackerInfo;
  tmux: TmuxInfo;
}

export interface BaselineSummary {
  sha: string;
  source: BaselineSource;
  failures: number;
}

export interface CheckRun {
  name: string;
  cmd: string;
  exit_code: number;
  duration_ms: number;
  timed_out: boolean;
  failures: number;
  new_failures: string[];
  fixed: string[];
  baseline: BaselineSummary;
  log: string;
}

export interface BaseInfo {
  ref: string;
  sha: string;
}

export interface CheckResult {
  ok: boolean;
  task: string;
  round: number;
  worktree: string;
  commit: string;
  base: BaseInfo;
  checks: CheckRun[];
  summary: string;
  file: string;
}

export interface LinkTarget {
  name: string;
  source: string;
  link: string;
}

export type LinkState = "linked" | "unchanged" | "skipped";

export interface LinkEntry extends LinkTarget {
  state: LinkState;
}

/** `ok` is false when a link was skipped; like `check`, the exit code stays 0. */
export interface InstallResult {
  ok: boolean;
  claude_dir: string;
  links: LinkEntry[];
}

export interface Failure {
  ok: false;
  error: string;
  code: string;
  details?: unknown;
}
