import type { BaselineSource } from "../../domain/failures.ts";
import type { TrackerKind } from "../../domain/manifest.ts";
import type { StatsProof } from "../../domain/proof.ts";
import type { SessionRemoveState, TmuxInfo } from "../application/sessions.ts";
import type { SetupResult } from "../application/setups.ts";
import type { ArchiveState } from "../application/tasks.ts";
import type { BranchRemoveState, WorktreeRemoveState } from "../application/worktrees/index.ts";

/* Command outputs: the shape of the one JSON document each command prints. */

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

export interface ArchiveInfo {
  path: string;
  state: ArchiveState;
}

export interface SessionRemoveInfo {
  session: string;
  state: SessionRemoveState;
}

export interface WorktreeRemoveInfo {
  path: string;
  state: WorktreeRemoveState;
}

export interface BranchRemoveInfo {
  name: string;
  state: BranchRemoveState;
}

export type StatsState = "written" | "skipped" | `failed: ${string}`;

export interface StatsInfo {
  path: string;
  state: StatsState;
}

export interface CloseResult {
  ok: true;
  task: string;
  project: string;
  forced: boolean;
  archive: ArchiveInfo;
  stats: StatsInfo;
  tmux: SessionRemoveInfo;
  worktree: WorktreeRemoveInfo;
  branch: BranchRemoveInfo;
  tracker: TrackerInfo;
}

export type PrState = "created" | "updated";

export interface PrInfo {
  number: number;
  url: string;
  state: PrState;
  draft: boolean;
}

export interface PrResult {
  ok: true;
  task: string;
  branch: string;
  commit: string;
  pr: PrInfo;
}

export interface ProofResult {
  ok: true;
  task: string;
  proof: StatsProof;
  file: string;
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
