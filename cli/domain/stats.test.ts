import { expect, test } from "bun:test";
import { checksPassed, countPlan, sumCode } from "./stats.ts";

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
