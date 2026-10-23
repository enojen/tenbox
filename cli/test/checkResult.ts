import type { CheckResult } from "../../domain/checks.ts";

/** A `checks.json` of round 1 with no checks; `fields` replace the defaults. */
export function checkResult(fields: Partial<CheckResult>): CheckResult {
  return {
    ok: true,
    task: "T-1",
    round: 1,
    worktree: "/wt/demo/T-1",
    commit: "c",
    base: { ref: "main", sha: "b" },
    checks: [],
    summary: "all pass",
    file: ".tenbox/rounds/1/checks.json",
    tier: "fast",
    ...fields,
  };
}
