import { expect, test } from "bun:test";
import { taskId } from "./ids.ts";
import { checksSummary, prBody, prTitle } from "./pr.ts";

const PLAN = "# T\n\n## Summary\nAdd the thing.\n";

test("prTitle joins id and title, or gives the id alone", () => {
  expect(prTitle(taskId("TB-7"), "tenbox pr")).toBe("TB-7 · tenbox pr");
  expect(prTitle(taskId("TB-7"), null)).toBe("TB-7");
});

test("prBody puts the checks summary first, then the whole plan folded", () => {
  expect(prBody(PLAN, "2 checks pass")).toBe(
    "## Checks\n\n2 checks pass\n\n<details><summary>Plan</summary>\n\n# T\n\n## Summary\nAdd the thing.\n</details>",
  );
});

test("prBody leaves out what is missing", () => {
  expect(prBody(null, null)).toBe("");
  expect(prBody(null, "ok")).toBe("## Checks\n\nok");
});

test("checksSummary reads summary, or null for missing text, bad JSON or no summary", () => {
  expect(checksSummary('{"ok":true,"summary":"2 checks pass"}')).toBe("2 checks pass");
  expect(checksSummary(null)).toBeNull();
  expect(checksSummary("not json")).toBeNull();
  expect(checksSummary('{"ok":true}')).toBeNull();
});
