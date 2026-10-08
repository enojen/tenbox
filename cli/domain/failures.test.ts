import { describe, expect, test } from "bun:test";
import { compareWithBaseline, failureLine, parseFailures } from "./failures.ts";

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
