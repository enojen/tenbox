import { isProof, type StatsProof } from "./proof.ts";
import { isPlainObject, minutesBetween, toMinutes } from "./utils.ts";

/* The plan and build workflow runs of one task, read from Claude Code's session files. */

const PLAN_WORKFLOW = "tenbox-plan";
const BUILD_WORKFLOW = "tenbox-build";
const READY_STATUS = "ready-for-you";

/** One workflow agent; `tokens` is the count Claude Code shows for it. */
export interface RunAgent {
  workflow: string;
  label: string | null;
  phase: string | null;
  role: string | null;
  model: string | null;
  started: string | null;
  seconds: number | null;
  tokens: number | null;
  tool_calls: number | null;
}

/** One workflow run; `result` is read for counts only. */
export interface WorkflowRun {
  workflow: string;
  started: string;
  ended: string;
  durationMs: number;
  result: unknown;
  agents: RunAgent[];
}

/** First start and last end of the plan and build runs. */
export interface RunTimeline {
  plan_start: string | null;
  plan_end: string | null;
  build_start: string | null;
  build_end: string | null;
}

export interface RunMinutes {
  plan: number | null;
  wait_approval: number | null;
  build: number | null;
  human_review: number | null;
}

/** Counts from the last build run's result; must_fix is 0 for a ready run, null otherwise. */
export interface RunReview {
  must_fix: number | null;
  nice_to_have: number | null;
  attention: number | null;
}

/** A part a reviewer found without a proof; `part` is the `NN` of the part file name. */
export interface RunUnproven {
  part: string;
  reason: string;
}

/** What the runs add to the stats; agents are null without session files. */
export interface RunSummary {
  timeline: RunTimeline;
  minutes: RunMinutes;
  review: RunReview | null;
  /** Every build run's unproven items, oldest first. */
  unproven: RunUnproven[];
  /** Every build run's proofs, oldest first. */
  proofs: StatsProof[];
  agents: RunAgent[] | null;
}

/** The runs that started at or after `opened`: older ones belong to an older worktree. */
export function summarizeRuns(
  all: WorkflowRun[] | null,
  opened: string | null,
  closed: string,
): RunSummary {
  const runs = runsSince(all ?? [], opened);
  const plan = runs.filter((run) => run.workflow === PLAN_WORKFLOW);
  const build = runs.filter((run) => run.workflow === BUILD_WORKFLOW);
  const timeline: RunTimeline = {
    plan_start: plan[0]?.started ?? null,
    plan_end: latestEnd(plan),
    build_start: build[0]?.started ?? null,
    build_end: latestEnd(build),
  };
  return {
    timeline,
    minutes: {
      plan: sumMinutes(plan),
      wait_approval: waitMinutes(timeline),
      build: sumMinutes(build),
      human_review: minutesBetween(timeline.build_end, closed),
    },
    review: reviewCounts(build.at(-1)),
    unproven: build.flatMap(unprovenItems),
    proofs: build.flatMap(proofItems),
    agents: all === null ? null : runs.flatMap((run) => run.agents),
  };
}

/** Oldest first; all of them when `opened` is null. */
function runsSince(runs: WorkflowRun[], opened: string | null): WorkflowRun[] {
  const from = opened === null ? Number.NEGATIVE_INFINITY : Date.parse(opened);
  const inside = runs.filter((run) => Date.parse(run.started) >= from);
  return inside.sort((a, b) => Date.parse(a.started) - Date.parse(b.started));
}

function latestEnd(runs: WorkflowRun[]): string | null {
  const ends = runs.map((run) => Date.parse(run.ended));
  return ends.length === 0 ? null : new Date(Math.max(...ends)).toISOString();
}

function sumMinutes(runs: WorkflowRun[]): number | null {
  if (runs.length === 0) return null;
  return toMinutes(runs.reduce((sum, run) => sum + run.durationMs, 0));
}

/** Null when a plan run ended after the build started: there was no wait then. */
function waitMinutes(timeline: RunTimeline): number | null {
  const minutes = minutesBetween(timeline.plan_end, timeline.build_start);
  return minutes !== null && minutes < 0 ? null : minutes;
}

const lengthOrNull = (value: unknown): number | null =>
  Array.isArray(value) ? value.length : null;

function reviewCounts(run: WorkflowRun | undefined): RunReview | null {
  if (run === undefined) return null;
  const result = isPlainObject(run.result) ? run.result : {};
  return {
    must_fix: result.status === READY_STATUS ? 0 : null,
    nice_to_have: lengthOrNull(result.nice_to_have),
    attention: lengthOrNull(result.attention),
  };
}

function unprovenItems(run: WorkflowRun): RunUnproven[] {
  const items = isPlainObject(run.result) ? run.result.unproven : null;
  if (!Array.isArray(items)) return [];
  return items.filter(isUnproven);
}

function isUnproven(item: unknown): item is RunUnproven {
  return isPlainObject(item) && typeof item.part === "string" && typeof item.reason === "string";
}

function proofItems(run: WorkflowRun): StatsProof[] {
  const items = isPlainObject(run.result) ? run.result.proofs : null;
  if (!Array.isArray(items)) return [];
  return items.filter(isProof);
}
