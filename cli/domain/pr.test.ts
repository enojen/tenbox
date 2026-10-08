import { expect, test } from "bun:test";
import { taskId } from "./ids.ts";
import { checksSummary, prBody, prTitle } from "./pr.ts";

const PLAN = `# T

## Summary
Add the thing.

## Approach
steps

## Risks and attention
- it pushes

## Review
x
`;

test("prTitle joins id and title, or gives the id alone", () => {
  expect(prTitle(taskId("TB-7"), "tenbox pr")).toBe("TB-7 · tenbox pr");
  expect(prTitle(taskId("TB-7"), null)).toBe("TB-7");
});

test("prBody orders risks, summary and checks", () => {
  expect(prBody(PLAN, "2 checks pass")).toBe(
    "## Risks and attention\n\n- it pushes\n\n## Summary\n\nAdd the thing.\n\n## Checks\n\n2 checks pass",
  );
});

test("prBody leaves out what is missing", () => {
  expect(prBody(null, null)).toBe("");
  expect(prBody("## Summary\n\n## Approach\nx\n", "ok")).toBe("## Checks\n\nok");
});

test("checksSummary reads summary, or null for missing text, bad JSON or no summary", () => {
  expect(checksSummary('{"ok":true,"summary":"2 checks pass"}')).toBe("2 checks pass");
  expect(checksSummary(null)).toBeNull();
  expect(checksSummary("not json")).toBeNull();
  expect(checksSummary('{"ok":true}')).toBeNull();
});
