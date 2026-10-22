import { expect, test } from "bun:test";
import { taskId } from "./ids.ts";
import { bodyHasLine, CI_STATE, ciState, groupLine, parseCiChecks, prBody, prTitle } from "./pr.ts";

const PLAN = "# T\n\n## Summary\nAdd the thing.\n";

test("prTitle joins id and title, or gives the id alone", () => {
  expect(prTitle(taskId("TB-7"), "tenbox pr")).toBe("TB-7 · tenbox pr");
  expect(prTitle(taskId("TB-7"), null)).toBe("TB-7");
});

test("prBody puts the group line first, then the checks summary, then the whole plan folded", () => {
  expect(prBody("tenbox: TB-7 group 1", PLAN, "2 checks pass")).toBe(
    "tenbox: TB-7 group 1\n\n## Checks\n\n2 checks pass\n\n<details><summary>Plan</summary>\n\n# T\n\n## Summary\nAdd the thing.\n</details>",
  );
});

test("prBody leaves out what is missing", () => {
  expect(prBody("L", null, null)).toBe("L");
  expect(prBody("L", null, "ok")).toBe("L\n\n## Checks\n\nok");
});

test("groupLine names the task and the group", () => {
  expect(groupLine(taskId("TB-7"), 2)).toBe("tenbox: TB-7 group 2");
});

test("bodyHasLine matches a whole line only", () => {
  const line = "tenbox: TB-7 group 1";
  expect(bodyHasLine(`${line}\n\nrest`, line)).toBe(true);
  expect(bodyHasLine(`intro\r\n${line}\r\n`, line)).toBe(true);
  expect(bodyHasLine("tenbox: TB-7 group 10\n", line)).toBe(false);
  expect(bodyHasLine(`see ${line}`, line)).toBe(false);
});

const line = (name: string, state: string) => `${name}\t${state}\t1m\thttps://x/${name}`;

test("parseCiChecks reads name, state, time and url and ignores extra columns", () => {
  const text = `${line("lint", "pass")}\textra\n\n${line("unit", "pending")}\n`;
  expect(parseCiChecks(text)).toEqual([
    { name: "lint", state: "pass", time: "1m", url: "https://x/lint" },
    { name: "unit", state: "pending", time: "1m", url: "https://x/unit" },
  ]);
});

test("ciState is pending while a check is pending", () => {
  const checks = parseCiChecks([line("a", "pass"), line("b", "pending")].join("\n"));
  expect(ciState(checks)).toBe(CI_STATE.pending);
});

test("ciState is pass for pass and skipping lines", () => {
  const checks = parseCiChecks([line("a", "pass"), line("b", "skipping")].join("\n"));
  expect(ciState(checks)).toBe(CI_STATE.pass);
});

test("ciState is fail for a cancel or fail line, and none for no checks", () => {
  expect(ciState(parseCiChecks(line("a", "cancel")))).toBe(CI_STATE.fail);
  expect(ciState(parseCiChecks([line("a", "pending"), line("b", "fail")].join("\n")))).toBe(
    CI_STATE.fail,
  );
  expect(ciState([])).toBe(CI_STATE.none);
});
