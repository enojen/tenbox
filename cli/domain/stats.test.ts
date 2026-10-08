import { expect, test } from "bun:test";
import { checksPassed, countPlan, countPoints, parseProofs, partIdOf, sumCode } from "./stats.ts";

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

test("partIdOf takes the NN prefix of a part file name", () => {
  expect(partIdOf("01-proofs-points.md")).toBe("01");
  expect(partIdOf("notes.md")).toBe("notes");
});

test("parseProofs reads well-formed lines in the proofs block and ignores the rest", () => {
  const text = [
    "# 01",
    "- not: a > proof: got x",
    "proofs:",
    "- a/b.test.ts > first: got 137",
    "- a/b.test.ts > name: with colon: got 1: bad",
    "- malformed line",
    "- a/b.test.ts > no failure",
    "result: x",
    "- c.test.ts > after: got 2",
  ].join("\n");
  expect(parseProofs("01", text)).toEqual({
    proofs: [
      { part: "01", file: "a/b.test.ts", test: "first", failure: "137" },
      { part: "01", file: "a/b.test.ts", test: "name: with colon", failure: "1: bad" },
    ],
    ignored: 2,
  });
  expect(parseProofs("01", "status: done\n")).toEqual({ proofs: [], ignored: 0 });
});

test("countPoints gives +1 per proof and -1 per unproven item, per part in order", () => {
  let count = 0;
  const proof = (part: string) => ({ part, file: "f", test: `t${count++}`, failure: "x" });
  const points = countPoints({
    partIds: ["01", "02", "03"],
    proofs: [proof("01"), proof("01"), proof("02")],
    ignored: { "01": 2 },
    unproven: [
      { part: "02", reason: "r" },
      { part: "07", reason: "r" },
    ],
  });
  expect(points).toEqual([
    { part: "01", points: 2, ignored_proofs: 2 },
    { part: "02", points: 0, ignored_proofs: 0 },
    { part: "03", points: 0, ignored_proofs: 0 },
    { part: "07", points: -1, ignored_proofs: 0 },
  ]);
});

test("proof lines with the same test file and test name count once", () => {
  const line = (file: string, test: string, failure: string) =>
    `- ${file} > ${test}: got ${failure}`;
  const text = [
    "proofs:",
    line("a.test.ts", "one", "x"),
    line("a.test.ts", "two", "x"),
    line("a.test.ts", "three", "x"),
    line("b.test.ts", "one", "x"),
    line("b.test.ts", "four", "x"),
    line("a.test.ts", "one", "rewritten"),
    line("a.test.ts", "two", "rewritten"),
    line("a.test.ts", "three", "rewritten"),
  ].join("\n");
  const { proofs } = parseProofs("01", text);
  expect(proofs).toHaveLength(5);
  const points = countPoints({ partIds: ["01"], proofs, ignored: {}, unproven: [] });
  expect(points).toEqual([{ part: "01", points: 5, ignored_proofs: 0 }]);
});
