import type { AUTO_ANSWER_STATE } from "../../domain/answers.ts";
import type { Approval } from "../../domain/approval.ts";
import type { RoundStatus } from "../../domain/build.ts";
import type { BaselineSource } from "../../domain/failures.ts";
import type { CheckTier, TrackerKind } from "../../domain/manifest.ts";
import type { CiCheck, CiState, GroupPrState } from "../../domain/pr.ts";
import type { StatsProof } from "../../domain/proof.ts";
import type { RunMark, UsageReport } from "../../domain/runs.ts";
import type { FailedState } from "../../domain/utils.ts";
import type { AnswerSaved } from "../application/answers.ts";
import type { DecisionsSaved } from "../application/decisions.ts";
import type { SessionStartInfo, SessionStopState } from "../application/sessions.ts";
import type { SetupResult } from "../application/setups.ts";
import type { StatsFrom } from "../application/stats.ts";
import type { StatusUpdate } from "../application/tasks.ts";
import type { BranchRemoveState, WorktreeRemoveState } from "../application/worktrees/index.ts";
import type { PrBranch, WorkflowRunRow } from "../infra/gh.ts";
import type { COMMENT_STATE, PULL_STATE, REMOTE_BRANCH_STATE, STATS_STATE } from "./close.ts";
import type { LINK_STATE } from "./install.ts";

/* Command outputs: the shape of the one JSON document each command prints. */

interface TrackerInfo {
  kind: TrackerKind;
  status: StatusUpdate;
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

export interface WorktreeResult {
  ok: true;
  task: string;
  group: number;
  worktree: string;
  branch: string;
  created: boolean;
}

export type SessionState = SessionStopState | FailedState;

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

type StatsState = (typeof STATS_STATE)[keyof typeof STATS_STATE] | FailedState;

export interface StatsInfo {
  /** Null when the stats were skipped. */
  path: string | null;
  state: StatsState;
}

export type PullState = (typeof PULL_STATE)[keyof typeof PULL_STATE] | FailedState;

interface PullInfo {
  base: string;
  state: PullState;
}

export type RemoteBranchState =
  | (typeof REMOTE_BRANCH_STATE)[keyof typeof REMOTE_BRANCH_STATE]
  | FailedState;

interface RemoteBranchInfo {
  name: string;
  state: RemoteBranchState;
}

export type CommentState = (typeof COMMENT_STATE)[keyof typeof COMMENT_STATE] | FailedState;

interface CommentInfo {
  state: CommentState;
}

/** What the close did with one group above 1. */
export interface GroupCloseResult {
  group: number;
  worktree: WorktreeRemoveInfo;
  branch: BranchRemoveInfo;
  remote_branch: RemoteBranchInfo;
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
  /** The groups above 1 of the plan; the key is missing for a task without them. */
  groups?: GroupCloseResult[];
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

export interface PrInfo {
  number: number;
  url: string;
  draft: boolean;
}

/** `pr` is null for a waiting group with no PR yet. */
export interface GroupPrResult {
  group: number;
  branch: string;
  state: GroupPrState;
  pr: PrInfo | null;
  /** Only with state `conflict`: the files the rebase onto the base conflicted in. */
  files?: string[];
  /** Only with `--wait`, on a group that was pushed: its CI checks. */
  ci?: CiResult;
}

export interface CiResult {
  state: CiState;
  checks: CiCheck[];
}

export interface PrResult {
  ok: true;
  task: string;
  groups: GroupPrResult[];
}

/** The `pr` of `tenbox build done` when `tenbox pr` threw: the build stays recorded. */
export interface PrError {
  ok: false;
  error: string;
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
  /** The build prompt sent; missing with `--no-build`. */
  sent?: string;
}

export interface StatsResult extends UsageReport {
  ok: true;
  task: string;
  source: StatsFrom;
  /** Null for `stats.json`. */
  runs: RunMark[] | null;
}

/** `tenbox answer`: the chosen option, the resumed run and its session. */
export interface AnswerResult extends AnswerSaved {
  ok: true;
  task: string;
}

/** `tenbox answer --auto` when the card was answered or replaced before the deadline. */
interface AutoAnswerSkipped {
  ok: true;
  task: string;
  state: typeof AUTO_ANSWER_STATE.skipped;
}

/** `tenbox answer --auto` that answered with the recommended option. */
interface AutoAnswerDone extends AnswerResult {
  state: typeof AUTO_ANSWER_STATE.answered;
}

export type AutoAnswerResult = AutoAnswerSkipped | AutoAnswerDone;

export interface TaskFileResult {
  ok: true;
  task: string;
  file: string;
}

/** `tenbox wait --for round`: the status of the round that changed. */
export interface WaitRoundResult {
  ok: true;
  task: string;
  round: number;
  status: RoundStatus;
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
  /** New failures of the first run that the rerun did not repeat; they do not fail the check. */
  flaky: string[];
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

export type LinkState = (typeof LINK_STATE)[keyof typeof LINK_STATE];

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

export interface MachineRunResultJson {
  ok: true;
  task: string;
  cmd: string;
  /** The run on GitHub; null when `gh` printed none. */
  url: string | null;
}

export interface MachineLsResult {
  ok: true;
  runs: WorkflowRunRow[];
}
