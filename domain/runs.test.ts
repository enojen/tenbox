import { expect, test } from "bun:test";
import { type RunAgent, reportUsage, summarizeRuns, type WorkflowRun } from "./runs.ts";

const MS_PER_MINUTE = 60_000;

const NO_USAGE = { calls: null, input: null, output: null, cache_write: null, cache_read: null };

const agent = (model: string): RunAgent => ({
  workflow: "tenbox-build",
  label: "round 1: 01",
  phase: "Build",
  role: "worker",
  model,
  started: "2026-01-01T01:00:00.000Z",
  seconds: 10,
  tokens: 10,
  tool_calls: 1,
  round: 1,
  ...NO_USAGE,
});

const run = (workflow: string, started: string, minutes: number): WorkflowRun => ({
  workflow,
  started,
  ended: new Date(Date.parse(started) + minutes * MS_PER_MINUTE).toISOString(),
  durationMs: minutes * MS_PER_MINUTE,
  agents: [],
});

test("summarizeRuns gives timeline, minutes and agents of the runs after opened", () => {
  const old = { ...run("tenbox-build", "2025-12-31T00:00:00.000Z", 9), agents: [agent("x")] };
  const plans = [run("tenbox-plan", "2026-01-01T00:10:00.000Z", 3)];
  plans.push(run("tenbox-plan", "2026-01-01T00:00:00.000Z", 2));
  const firstBuild = run("tenbox-build", "2026-01-01T00:20:00.000Z", 4);
  const lastBuild = {
    ...run("tenbox-build", "2026-01-01T00:30:00.000Z", 5),
    agents: [agent("opus"), agent("sonnet")],
  };
  const runs = [old, lastBuild, firstBuild, ...plans];
  const summary = summarizeRuns(runs, "2026-01-01T00:00:00Z");
  expect(summary.timeline).toEqual({
    plan_start: "2026-01-01T00:00:00.000Z",
    plan_end: "2026-01-01T00:13:00.000Z",
    build_start: "2026-01-01T00:20:00.000Z",
    build_end: "2026-01-01T00:35:00.000Z",
  });
  expect(summary.minutes).toEqual({ plan: 5, wait_approval: 7, build: 9 });
  expect(summary.agents?.map((a) => a.model)).toEqual(["opus", "sonnet"]);
});

test("summarizeRuns: no wait when a plan run ends after the build started", () => {
  const plan = run("tenbox-plan", "2026-01-01T00:00:00.000Z", 10);
  const build = run("tenbox-build", "2026-01-01T00:05:00.000Z", 1);
  const summary = summarizeRuns([plan, build], null);
  expect(summary.minutes.wait_approval).toBeNull();
});

test("summarizeRuns: no session files give null agents and minutes", () => {
  const none = summarizeRuns(null, null);
  expect(none.agents).toBeNull();
  expect(none.minutes).toEqual({
    plan: null,
    wait_approval: null,
    build: null,
  });
});

const roundAgent = (round: number | null): RunAgent => ({ ...agent("m"), round });

const buildRun = (started: string, rounds: Array<number | null>): WorkflowRun => ({
  ...run("tenbox-build", started, 1),
  agents: rounds.map(roundAgent),
});

test("summarizeRuns numbers the rounds across the build runs", () => {
  const first = buildRun("2026-01-01T00:00:00.000Z", [1, 2, 3, 3, null]);
  const second = buildRun("2026-01-01T01:00:00.000Z", [1, 2, null]);
  const third = buildRun("2026-01-01T02:00:00.000Z", [1]);
  const summary = summarizeRuns([third, first, second], null);
  expect(summary.agents?.map((a) => a.round)).toEqual([1, 2, 3, 3, null, 4, 5, null, 6]);
});

test("summarizeRuns gives a plan run's agents no round", () => {
  const plan = { ...run("tenbox-plan", "2026-01-01T00:00:00.000Z", 1), agents: [roundAgent(1)] };
  const build = buildRun("2026-01-01T01:00:00.000Z", [1]);
  const summary = summarizeRuns([plan, build], null);
  expect(summary.agents?.map((a) => a.round)).toEqual([null, 1]);
});

const usageAgent = (fields: Partial<RunAgent>): RunAgent => ({
  ...agent("m"),
  calls: 1,
  input: 10,
  output: 5,
  cache_write: 2,
  cache_read: 1,
  ...fields,
});

test("reportUsage sums per round, role and model; rounds without a number come last", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
  const agents = [
    usageAgent({ round: null, role: "planner", started: at(0), seconds: 60 }),
    usageAgent({ round: 1, role: "worker", model: "opus", started: at(10), seconds: 120 }),
    usageAgent({ round: 1, role: "reviewer", model: "sonnet", started: at(14), seconds: 60 }),
    usageAgent({ round: 1, role: "worker", model: "opus", started: null, seconds: null, calls: 3 }),
  ];
  const report = reportUsage(agents);
  expect(report.rounds).toEqual([
    { round: 1, minutes: 5, calls: 5, input: 30, output: 15, cache_write: 6, cache_read: 3 },
    { round: null, minutes: 1, calls: 1, input: 10, output: 5, cache_write: 2, cache_read: 1 },
  ]);
  expect(report.roles.map((r) => [r.role, r.calls, r.output])).toEqual([
    ["planner", 1, 5],
    ["worker", 4, 10],
    ["reviewer", 1, 5],
  ]);
  expect(report.models.map((m) => [m.model, m.calls])).toEqual([
    ["m", 1],
    ["opus", 4],
    ["sonnet", 1],
  ]);
});

test("reportUsage counts an agent without a transcript as zero and has no minutes without times", () => {
  const bare = { ...agent("m"), round: 2, started: null, seconds: null };
  const report = reportUsage([bare]);
  expect(report.rounds).toEqual([
    { round: 2, minutes: null, calls: 0, input: 0, output: 0, cache_write: 0, cache_read: 0 },
  ]);
});
