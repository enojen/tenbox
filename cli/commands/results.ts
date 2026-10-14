import type { Approval } from "../../domain/approval.ts";
import type { BaselineSource } from "../../domain/failures.ts";
import type { CheckTier, TrackerKind } from "../../domain/manifest.ts";
import type { StatsProof } from "../../domain/proof.ts";
import type { UsageReport } from "../../domain/runs.ts";
import type { DecisionsSaved } from "../application/decisions.ts";
import type { SessionStartInfo, SessionStopState } from "../application/sessions.ts";
import type { SetupResult } from "../application/setups.ts";
import type { StatsFrom } from "../application/stats.ts";
import type { BranchRemoveState, WorktreeRemoveState } from "../application/worktrees/index.ts";
import type { PrBranch } from "../infra/gh.ts";

/* Command outputs: the shape of the one JSON document each command prints. */

interface TrackerInfo {
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
  claude: SessionStartInfo;
}

export type SessionState = SessionStopState | `failed: ${string}`;

interface SessionStopInfo {
  state: SessionState;
}

interface WorktreeRemoveInfo {
  path: string;
  state: WorktreeRemoveState;
}

interface BranchRemoveInfo {
  name: string;
  state: BranchRemoveState;
}

type StatsState = "written" | "skipped" | `failed: ${string}`;

export interface StatsInfo {
  /** Null when the stats were skipped. */
  path: string | null;
  state: StatsState;
}

export type PullState = "pulled" | "skipped" | `failed: ${string}`;

interface PullInfo {
  base: string;
  state: PullState;
}

export type RemoteBranchState = "deleted" | "skipped" | `failed: ${string}`;

interface RemoteBranchInfo {
  name: string;
  state: RemoteBranchState;
}

export type CommentState = "posted" | "skipped" | `failed: ${string}`;

interface CommentInfo {
  state: CommentState;
}

export interface CloseResult {
  ok: true;
  task: string;
  project: string;
  forced: boolean;
  pull: PullInfo;
  stats: StatsInfo;
  session: SessionStopInfo;
  worktree: WorktreeRemoveInfo;
  branch: BranchRemoveInfo;
  remote_branch: RemoteBranchInfo;
  tracker: TrackerInfo;
  comment: CommentInfo;
}

export interface SendBuildResult {
  ok: true;
  task: string;
  /** The prompt the new background session started with. */
  sent: string;
}

export interface AttachResult {
  ok: true;
  task: string;
  /** The id of the background session that was opened. */
  session: string;
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

export interface DecideResult extends DecisionsSaved {
  ok: true;
  task: string;
}

export interface StatsResult extends UsageReport {
  ok: true;
  task: string;
  source: StatsFrom;
}

export interface TaskFileResult {
  ok: true;
  task: string;
  file: string;
}

export interface ApproveResult extends Approval {
  ok: true;
  task: string;
  file: string;
}

interface BaselineSummary {
  sha: string;
  source: BaselineSource;
  failures: number;
}

export interface CheckOutcome {
  name: string;
  cmd: string;
  exit_code: number;
  duration_ms: number;
  timed_out: boolean;
  failures: number;
  new_failures: string[];
  fixed: string[];
  baseline: BaselineSummary;
}

export interface CheckRun extends CheckOutcome {
  log: string;
}

interface BaseInfo {
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
  tier: CheckTier;
}

export interface MergeCheckResult {
  ok: boolean;
  base: BaseInfo;
  /** The open task PRs, as `gh` lists them. */
  prs: PrBranch[];
  /** Their branches in the order they were merged: lowest PR number first. */
  order: string[];
  checks: CheckOutcome[];
  summary: string;
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
