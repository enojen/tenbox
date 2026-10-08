import { expect, test } from "bun:test";
import { prBody, prTitle } from "./pr.ts";

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
  expect(prTitle("TB-7", "tenbox pr")).toBe("TB-7 · tenbox pr");
  expect(prTitle("TB-7", null)).toBe("TB-7");
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
