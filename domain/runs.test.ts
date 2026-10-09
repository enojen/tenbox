import { expect, test } from "bun:test";
import { type RunAgent, summarizeRuns, type WorkflowRun } from "./runs.ts";

const MS_PER_MINUTE = 60_000;

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
  const summary = summarizeRuns(runs, "2026-01-01T00:00:00Z", "2026-01-01T01:05:00.000Z");
  expect(summary.timeline).toEqual({
    plan_start: "2026-01-01T00:00:00.000Z",
    plan_end: "2026-01-01T00:13:00.000Z",
    build_start: "2026-01-01T00:20:00.000Z",
    build_end: "2026-01-01T00:35:00.000Z",
  });
  expect(summary.minutes).toEqual({ plan: 5, wait_approval: 7, build: 9, human_review: 30 });
  expect(summary.agents?.map((a) => a.model)).toEqual(["opus", "sonnet"]);
});

test("summarizeRuns: no wait when a plan run ends after the build started", () => {
  const plan = run("tenbox-plan", "2026-01-01T00:00:00.000Z", 10);
  const build = run("tenbox-build", "2026-01-01T00:05:00.000Z", 1);
  const summary = summarizeRuns([plan, build], null, "2026-01-01T01:00:00.000Z");
  expect(summary.minutes.wait_approval).toBeNull();
});

test("summarizeRuns: no session files give null agents and minutes", () => {
  const none = summarizeRuns(null, null, "2026-01-01T01:00:00.000Z");
  expect(none.agents).toBeNull();
  expect(none.minutes).toEqual({
    plan: null,
    wait_approval: null,
    build: null,
    human_review: null,
  });
});
