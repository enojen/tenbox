import { expect, test } from "bun:test";
import { readApproval } from "./approval.ts";

const AT = "2026-10-14T12:00:00.000Z";
const FILE = "/t/.tenbox/approved.json";

test("an approval with an ISO time is read", () => {
  const text = JSON.stringify({ at: AT, plan_sha: "abc" });
  expect(readApproval(text, FILE)).toEqual({ at: AT, plan_sha: "abc" });
});

test("an approval whose time is not an ISO date-time is bad-file", () => {
  const text = JSON.stringify({ at: "14.10.2026", plan_sha: "abc" });
  expect(() => readApproval(text, FILE)).toThrow(expect.objectContaining({ code: "bad-file" }));
});
