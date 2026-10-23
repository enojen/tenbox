import { expect, test } from "bun:test";
import { type CheckResult, type CheckRun, readCheckResult } from "./checks.ts";

const FILE = "/t/.tenbox/rounds/1/checks.json";

const RUN: CheckRun = {
  name: "unit",
  cmd: "bun test",
  exit_code: 0,
  duration_ms: 10,
  timed_out: false,
  failures: 0,
  new_failures: [],
  flaky: [],
  fixed: [],
  baseline: { sha: "b", source: "main", failures: 0 },
  log: "rounds/1/unit.log",
};

const RESULT: CheckResult = {
  ok: true,
  task: "T-1",
  round: 1,
  worktree: "/wt/demo/T-1",
  commit: "c",
  base: { ref: "main", sha: "b" },
  checks: [RUN],
  summary: "all pass",
  file: ".tenbox/rounds/1/checks.json",
  tier: "fast",
};

test("a check result that tenbox check writes is read", () => {
  expect(readCheckResult(JSON.stringify(RESULT), FILE)).toEqual(RESULT);
});

test("a check result without flaky, from before flaky was written, is bad-file", () => {
  const { flaky: _, ...old } = RUN;
  const text = JSON.stringify({ ...RESULT, checks: [old] });
  expect(() => readCheckResult(text, FILE)).toThrow(`${FILE} is not valid: checks.0.flaky`);
});

test("a check result without tier is bad-file", () => {
  const { tier: _, ...old } = RESULT;
  expect(() => readCheckResult(JSON.stringify(old), FILE)).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
});
