import { describe, expect, test } from "bun:test";
import {
  closeComment,
  countPlan,
  countPoints,
  distinctProofs,
  readStatsRecord,
  sumCode,
  type TaskStats,
} from "./stats.ts";

const NO_USAGE = {
  workflow: "w",
  label: null,
  phase: null,
  role: null,
  model: null,
  started: null,
  seconds: null,
  tokens: null,
  tool_calls: null,
  round: null,
  calls: null,
  input: null,
  cache_write: null,
  cache_read: null,
};

function statsWith(output: (number | null)[], total: number | null): TaskStats {
  return {
    schema: 7,
    project: "p",
    task: "T-1",
    title: null,
    user: null,
    tenbox: null,
    forced: false,
    timeline: {
      opened: null,
      plan_start: null,
      plan_end: null,
      build_start: null,
      build_end: null,
      closed: "2026-01-01T00:00:00Z",
    },
    minutes: {
      plan: null,
      wait_approval: null,
      build: null,
      review: null,
      wait_merge: null,
      total,
    },
    plan: null,
    rounds: [
      { number: 1, checks_passed: false },
      { number: 2, checks_passed: true },
    ],
    review: null,
    proofs: [],
    points: [],
    code: null,
    agents: output.map((out) => ({ ...NO_USAGE, output: out })),
    runs: [],
    findings: [],
  };
}

describe("closeComment", () => {
  test("sums output tokens over the agents in thousands", () => {
    expect(closeComment(statsWith([40_000, null, 48_400], 384))).toBe(
      "384 min, 88k tokens, 2 rounds",
    );
  });
  test("rounds the minutes to a whole number", () => {
    expect(closeComment(statsWith([1000], 384.7))).toBe("385 min, 1k tokens, 2 rounds");
  });
  test("without agents or minutes it is 0 min, 0k tokens", () => {
    const empty = { ...statsWith([], null), agents: null };
    expect(closeComment(empty)).toBe("0 min, 0k tokens, 2 rounds");
  });
  test("the opened findings follow as their urls; one with no task is left out", () => {
    const findings = [
      { title: "a", task: { id: "5", url: "https://github.com/o/r/issues/5" } },
      { title: "b", task: null },
      { title: "c", task: { id: "6", url: "https://github.com/o/r/issues/6" } },
    ];
    const stats = { ...statsWith([1000], 10), findings };
    expect(closeComment(stats)).toBe(
      "10 min, 1k tokens, 2 rounds, opened https://github.com/o/r/issues/5, https://github.com/o/r/issues/6",
    );
  });
});

test("countPlan lists each part's difficulty in order and the estimated lines", () => {
  const plan = countPlan({
    kind: "normal",
    summary: "s",
    estimated_lines: 120,
    parts: [
      { id: "01", difficulty: "easy" },
      { id: "02", difficulty: "hard" },
    ],
    examples: [],
    decisions: [],
    lenses: [],
    questions: [],
  });
  expect(plan).toEqual({ parts: 2, difficulty: ["easy", "hard"], estimated_lines: 120 });
  expect(countPlan(null)).toBeNull();
});

test("sumCode counts test files apart", () => {
  const changed = [
    { added: 3, removed: 0, path: "src/a.ts" },
    { added: 2, removed: 0, path: "src/a.test.ts" },
    { added: 1, removed: 1, path: "test/b.ts" },
  ];
  expect(sumCode(changed)).toEqual({ added: 6, removed: 1, files: 3, test_added: 3 });
  expect(sumCode([])).toEqual({ added: 0, removed: 0, files: 0, test_added: 0 });
});

test("countPoints gives +1 per proof and -1 per unproven item, per part in order", () => {
  let count = 0;
  const proof = (part: string) => ({ part, file: "f", test: `t${count++}`, failure: "x" });
  const points = countPoints({
    partIds: ["01", "02", "03"],
    proofs: [proof("01"), proof("01"), proof("02")],
    unproven: [
      { part: "02", reason: "r" },
      { part: "07", reason: "r" },
    ],
  });
  expect(points).toEqual([
    { part: "01", points: 2 },
    { part: "02", points: 0 },
    { part: "03", points: 0 },
    { part: "07", points: -1 },
  ]);
});

test("distinctProofs keeps the first proof of each part, test file and test name", () => {
  const proof = (part: string, file: string, test: string, failure: string) => ({
    part,
    file,
    test,
    failure,
  });
  const proofs = [
    proof("01", "a.test.ts", "one", "x"),
    proof("01", "a.test.ts", "two", "x"),
    proof("01", "b.test.ts", "one", "x"),
    proof("02", "a.test.ts", "one", "x"),
    proof("01", "a.test.ts", "one", "rewritten"),
    proof("01", "a.test.ts", "two", "rewritten"),
  ];
  const distinct = distinctProofs(proofs);
  expect(distinct).toEqual(proofs.slice(0, 4));
  const points = countPoints({ partIds: ["01", "02"], proofs: distinct, unproven: [] });
  expect(points).toEqual([
    { part: "01", points: 3 },
    { part: "02", points: 1 },
  ]);
});

test("distinctProofs and countPoints group a part file slug and its number as one part", () => {
  const proof = (part: string, test: string, failure: string) => ({
    part,
    file: "a.test.ts",
    test,
    failure,
  });
  const distinct = distinctProofs([
    proof("01-x", "same", "from the run"),
    proof("01", "same", "recorded"),
    proof("01", "other", "recorded"),
  ]);
  expect(distinct).toEqual([proof("01", "same", "from the run"), proof("01", "other", "recorded")]);
  const points = countPoints({
    partIds: ["01"],
    proofs: distinct,
    unproven: [{ part: "01-x", reason: "r" }],
  });
  expect(points).toEqual([{ part: "01", points: 1 }]);
});

const AGENT = {
  workflow: "tenbox-build",
  label: "round 1: 01",
  phase: "Build",
  role: "worker",
  model: "m",
  started: "2026-01-01T00:00:00.000Z",
  seconds: 10,
  tokens: 1,
  tool_calls: 1,
  round: 1,
  calls: 2,
  input: 3,
  output: 4,
  cache_write: 5,
  cache_read: 6,
};

const STATS_FILE = "/t/stats.json";

test("readStatsRecord gives the agents of a schema 5 stats.json with no runs, or no agents", () => {
  const withAgents = JSON.stringify({ schema: 5, agents: [AGENT] });
  expect(readStatsRecord(withAgents, STATS_FILE)).toEqual({ agents: [AGENT], runs: null });
  expect(readStatsRecord(JSON.stringify({ schema: 5, agents: null }), STATS_FILE)).toEqual({
    agents: [],
    runs: null,
  });
});

test("readStatsRecord gives the agents and runs of a schema 6 or 7 stats.json", () => {
  const run = { workflow: "tenbox-build", started: "2026-10-14T10:00:00.000Z", finished: false };
  const text = JSON.stringify({ schema: 6, agents: [AGENT], runs: [run] });
  const latest = JSON.stringify({ schema: 7, agents: [AGENT], runs: [run] });
  expect(readStatsRecord(text, STATS_FILE)).toEqual({ agents: [AGENT], runs: [run] });
  expect(readStatsRecord(latest, STATS_FILE)).toEqual({ agents: [AGENT], runs: [run] });
});

test.each([
  ["schema 3", JSON.stringify({ schema: 3, agents: [AGENT] })],
  ["schema 4, whose agents have no usage", JSON.stringify({ schema: 4, agents: [AGENT] })],
])("readStatsRecord gives null for an older %s", (_name, text) => {
  expect(readStatsRecord(text, STATS_FILE)).toBeNull();
});

test.each([
  ["text that is not JSON", "{nope"],
  ["no schema", JSON.stringify({ agents: [AGENT] })],
  [
    "a schema 5 agent without usage",
    JSON.stringify({ schema: 5, agents: [{ ...AGENT, calls: undefined }] }),
  ],
])("readStatsRecord refuses %s with bad-file", (_name, text) => {
  expect(() => readStatsRecord(text, STATS_FILE)).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
});
