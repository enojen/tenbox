import { z } from "zod";
import { MS_PER_SECOND, minutesBetween, toMinutes } from "./utils.ts";

/* The plan and build workflow runs of one task, read from Claude Code's session files. */

const PLAN_WORKFLOW = "tenbox-plan";
const BUILD_WORKFLOW = "tenbox-build";
const ROUND_LABEL = /^round (\d+):/;

/** The round in a label `round N: ...`; null for any other label. */
export function roundOfLabel(label: string | null): number | null {
  const match = label === null ? null : ROUND_LABEL.exec(label);
  return match?.[1] === undefined ? null : Number(match[1]);
}

const nullableCount = z.number().nullable();
const nullableText = z.string().nullable();

/**
 * One workflow agent; `tokens` is the count Claude Code shows for it. The usage fields sum the
 * agent's transcript, each message id once; they are null without a transcript. `round` is the
 * number in its label `round N: ...`: in a run from the session files it counts in that run, in
 * the agents of `summarizeRuns` it counts across the build runs.
 */
export const RunAgentSchema = z.object({
  workflow: z.string(),
  label: nullableText,
  phase: nullableText,
  role: nullableText,
  model: nullableText,
  started: nullableText,
  seconds: nullableCount,
  tokens: nullableCount,
  tool_calls: nullableCount,
  round: nullableCount,
  calls: nullableCount,
  input: nullableCount,
  output: nullableCount,
  cache_write: nullableCount,
  cache_read: nullableCount,
});

export type RunAgent = z.infer<typeof RunAgentSchema>;

/** Assistant messages and their tokens. */
export interface Usage {
  calls: number;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

interface RoundUsage extends Usage {
  /** Null for the agents outside a round: plan, approval, record build. */
  round: number | null;
  /** First agent start to last agent end; null when no agent has a time. */
  minutes: number | null;
}

interface RoleUsage extends Usage {
  role: string | null;
}

interface ModelUsage extends Usage {
  model: string | null;
}

export interface UsageReport {
  rounds: RoundUsage[];
  roles: RoleUsage[];
  models: ModelUsage[];
}

/** One workflow run. */
export interface WorkflowRun {
  workflow: string;
  started: string;
  ended: string;
  durationMs: number;
  /** False for a run with no run file: its session ended before the run did. */
  finished: boolean;
  agents: RunAgent[];
}

/** What stats keeps of a run, besides its agents. */
export interface RunMark {
  workflow: string;
  started: string;
  finished: boolean;
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
}

/** What the runs add to the stats; agents are null without session files. */
export interface RunSummary {
  timeline: RunTimeline;
  minutes: RunMinutes;
  agents: RunAgent[] | null;
  runs: RunMark[] | null;
}

/** The runs that started at or after `opened`: older ones belong to an older worktree. */
export function summarizeRuns(all: WorkflowRun[] | null, opened: string | null): RunSummary {
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
    },
    agents: all === null ? null : numberRounds(runs),
    runs: all === null ? null : runs.map(markOf),
  };
}

function markOf(run: WorkflowRun): RunMark {
  return { workflow: run.workflow, started: run.started, finished: run.finished };
}

/** The agents of the runs, oldest first. A build run's rounds continue after the earlier ones. */
function numberRounds(runs: WorkflowRun[]): RunAgent[] {
  let before = 0;
  return runs.flatMap((run) => {
    if (run.workflow !== BUILD_WORKFLOW) return run.agents.map((a) => ({ ...a, round: null }));
    const offset = before;
    before += Math.max(0, ...run.agents.map((a) => a.round ?? 0));
    return run.agents.map((a) => ({ ...a, round: a.round === null ? null : offset + a.round }));
  });
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

/** Calls and tokens per round, per role and per model. */
export function reportUsage(agents: RunAgent[]): UsageReport {
  const rounds = groupBy(agents, (agent) => agent.round).map(([round, group]) => ({
    round,
    minutes: spanMinutes(group),
    ...sumUsage(group),
  }));
  const byRound = (a: RoundUsage, b: RoundUsage) =>
    (a.round ?? Number.POSITIVE_INFINITY) - (b.round ?? Number.POSITIVE_INFINITY);
  return {
    rounds: rounds.sort(byRound),
    roles: groupBy(agents, (agent) => agent.role).map(([role, group]) => ({
      role,
      ...sumUsage(group),
    })),
    models: groupBy(agents, (agent) => agent.model).map(([model, group]) => ({
      model,
      ...sumUsage(group),
    })),
  };
}

/** The groups in the order their key first appears. */
function groupBy<K>(agents: RunAgent[], key: (agent: RunAgent) => K): Array<[K, RunAgent[]]> {
  const groups = new Map<K, RunAgent[]>();
  for (const agent of agents) {
    const group = groups.get(key(agent)) ?? [];
    group.push(agent);
    groups.set(key(agent), group);
  }
  return [...groups];
}

function sumUsage(agents: RunAgent[]): Usage {
  const sum = (pick: (agent: RunAgent) => number | null) =>
    agents.reduce((total, agent) => total + (pick(agent) ?? 0), 0);
  return {
    calls: sum((agent) => agent.calls),
    input: sum((agent) => agent.input),
    output: sum((agent) => agent.output),
    cache_write: sum((agent) => agent.cache_write),
    cache_read: sum((agent) => agent.cache_read),
  };
}

/** The first start to the last end of the agents that have a start and a length. */
function spanMinutes(agents: RunAgent[]): number | null {
  const spans: Array<[number, number]> = [];
  for (const { started, seconds } of agents) {
    if (started === null || seconds === null) continue;
    const start = Date.parse(started);
    spans.push([start, start + seconds * MS_PER_SECOND]);
  }
  if (spans.length === 0) return null;
  const first = Math.min(...spans.map(([start]) => start));
  const last = Math.max(...spans.map(([, end]) => end));
  return toMinutes(last - first);
}
