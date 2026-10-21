import { describe, expect, test } from "bun:test";
import {
  checksPassed,
  costComment,
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
    schema: 6,
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
  };
}

describe("costComment", () => {
  test("sums output tokens over the agents in thousands", () => {
    expect(costComment(statsWith([40_000, null, 48_400], 384))).toBe(
      "384 min, 88k tokens, 2 rounds",
    );
  });
  test("rounds the minutes to a whole number", () => {
    expect(costComment(statsWith([1000], 384.7))).toBe("385 min, 1k tokens, 2 rounds");
  });
  test("without agents or minutes it is 0 min, 0k tokens", () => {
    const empty = { ...statsWith([], null), agents: null };
    expect(costComment(empty)).toBe("0 min, 0k tokens, 2 rounds");
  });
});

test("countPlan lists each part's difficulty in order and the estimated lines", () => {
  const plan = countPlan({
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

test("checksPassed reads ok and gives null for anything else", () => {
  expect(checksPassed('{"ok":true}')).toBe(true);
  expect(checksPassed('{"ok":false}')).toBe(false);
  expect(checksPassed("{}")).toBeNull();
  expect(checksPassed("not json")).toBeNull();
  expect(checksPassed(null)).toBeNull();
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

test("readStatsRecord gives the agents of a schema 5 stats.json with no runs, or no agents", () => {
  const withAgents = JSON.stringify({ schema: 5, agents: [AGENT] });
  expect(readStatsRecord(withAgents)).toEqual({ agents: [AGENT], runs: null });
  expect(readStatsRecord(JSON.stringify({ schema: 5, agents: null }))).toEqual({
    agents: [],
    runs: null,
  });
});

test("readStatsRecord gives the agents and runs of a schema 6 stats.json", () => {
  const run = { workflow: "tenbox-build", started: "2026-10-14T10:00:00.000Z", finished: false };
  expect(readStatsRecord(JSON.stringify({ schema: 6, agents: [AGENT], runs: [run] }))).toEqual({
    agents: [AGENT],
    runs: [run],
  });
});

test.each([
  ["text that is not JSON", "{nope"],
  ["schema 3", JSON.stringify({ schema: 3, agents: [AGENT] })],
  ["schema 4, whose agents have no usage", JSON.stringify({ schema: 4, agents: [AGENT] })],
  [
    "an agent without usage",
    JSON.stringify({ schema: 5, agents: [{ ...AGENT, calls: undefined }] }),
  ],
])("readStatsRecord gives null for %s", (_name, text) => {
  expect(readStatsRecord(text)).toBeNull();
});
