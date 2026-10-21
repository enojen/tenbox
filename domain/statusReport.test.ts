import { expect, test } from "bun:test";
import { countParts } from "./part.ts";
import { reportLine, type StatusReport } from "./statusReport.ts";

const REPORT: StatusReport = {
  task: "T-1",
  title: null,
  status: "building",
  round: 2,
  approved: true,
  parts: { todo: 1, doing: 0, done: 2, blocked: 0 },
  session: { state: "working" },
  pr: null,
  checks: null,
};

test("reportLine gives one line with the status, round, parts, session and PR", () => {
  expect(reportLine(REPORT)).toBe("T-1 · building · round 2 · parts 2/3 · session working · PR -");
  const waiting = {
    ...REPORT,
    round: null,
    parts: countParts([]),
    pr: { number: 7, url: "u", draft: false },
  };
  expect(reportLine(waiting)).toBe(
    "T-1 · building · round - · parts 0/0 · session working · PR #7",
  );
});
