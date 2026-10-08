import { expect, test } from "bun:test";
import { checksPassed, countPlan, countPoints, distinctProofs, sumCode } from "./stats.ts";

test("countPlan lists each part's difficulty in order and the estimated lines", () => {
  const parts = ["# 01\nstatus: todo\ndifficulty: easy\n", "difficulty: hard\n", "no difficulty\n"];
  const plan = countPlan("## Size\nEstimated lines: 120 (tests included)\n", parts);
  expect(plan).toEqual({ parts: 3, difficulty: ["easy", "hard", null], estimated_lines: 120 });
  const noSize = countPlan("no size", []);
  expect(noSize?.estimated_lines).toBeNull();
  expect(countPlan(null, parts)).toBeNull();
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
