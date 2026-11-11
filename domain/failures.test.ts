import { describe, expect, test } from "bun:test";
import { compareWithBaseline, failureLine, judgeRerun, parseFailures } from "./failures.ts";

const lines = (...xs: string[]) => xs.map(failureLine);

describe("parseFailures", () => {
  test("keeps matching lines, strips ANSI, trims, sorts, dedupes", () => {
    const out = [
      "\x1b[31m FAIL  src/b.test.ts > b\x1b[0m",
      "  ✓ passes",
      "src/a.ts(3,1): error TS2322: Type 'x'",
      " FAIL  src/b.test.ts > b",
      "FAILURE is not a word boundary match",
      "× broken",
    ].join("\n");
    expect(parseFailures(out, 1)).toEqual(
      lines("FAIL  src/b.test.ts > b", "src/a.ts(3,1): error TS2322: Type 'x'", "× broken"),
    );
  });
  test("bun test: (fail) lines without their duration, the summary is not a failure", () => {
    const out = "(fail) boom [8.00ms]\n\n 1 pass\n 1 fail\nRan 2 tests across 1 file. [41.00ms]\n";
    expect(parseFailures(out, 1)).toEqual(lines("(fail) boom"));
  });
  test("vitest: × lines without their duration", () => {
    const out = "     × parses the answer 144ms\n     × waits for the reply 1.20s\n";
    expect(parseFailures(out, 1)).toEqual(lines("× parses the answer", "× waits for the reply"));
  });
  test("jest: ✕ and FAIL lines without their duration", () => {
    const out = "  ✕ adds two numbers (12 ms)\nFAIL src/sum.test.ts (5.123 s)\n";
    expect(parseFailures(out, 1)).toEqual(lines("FAIL src/sum.test.ts", "✕ adds two numbers"));
  });
  test("a jest test that fails in both runs with another duration is a new failure", () => {
    const first = parseFailures("  ✕ adds two numbers (12 ms)\n", 1);
    const rerun = parseFailures("  ✕ adds two numbers (15 ms)\n", 1);
    expect(judgeRerun(first, rerun)).toEqual({
      newFailures: lines("✕ adds two numbers"),
      flaky: [],
    });
  });
  test("non-zero exit with no matching line becomes one synthetic failure with the last line", () => {
    expect(parseFailures("bun test\nerror: Cannot find package 'hono'\n\n", 1)).toEqual(
      lines("exit 1: error: Cannot find package 'hono'"),
    );
    expect(parseFailures("Ran 2 tests across 1 file. [41.00ms]\n", 1)).toEqual(
      lines("exit 1: Ran 2 tests across 1 file."),
    );
    expect(parseFailures("BUILD FAILED in 3s\n", 1)).toEqual(lines("exit 1: BUILD FAILED"));
    expect(parseFailures("", 127)).toEqual(lines("exit 127"));
  });
  test("zero exit with no matching line is clean", () => {
    expect(parseFailures("all good", 0)).toEqual(lines());
  });
});

test("compareWithBaseline", () => {
  expect(compareWithBaseline(lines("a", "b"), lines("b", "c"))).toEqual({
    newFailures: lines("c"),
    fixed: lines("a"),
  });
});
