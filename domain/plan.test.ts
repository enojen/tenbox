import { expect, test } from "bun:test";
import { parsePlan, type PlanResult, readPlan } from "./plan.ts";

const valid: PlanResult = {
  summary: "s",
  estimated_lines: 120,
  parts: [
    { id: "01", difficulty: "easy" },
    { id: "02", difficulty: "hard" },
  ],
  criteria: ["c"],
  lenses: ["contract"],
  questions: [{ kind: "product", text: "q", blocking: false }],
};
const json = (change: Record<string, unknown>): string => JSON.stringify({ ...valid, ...change });

test("parsePlan returns the plan result", () => {
  expect(parsePlan(json({}))).toEqual(valid);
});

test("the bad-plan message names the field", () => {
  expect(() => parsePlan(json({ estimated_lines: "about 300" }))).toThrow("estimated_lines: ");
});

test.each([
  ["lines that are text", json({ estimated_lines: "about 300" })],
  ["a negative number of lines", json({ estimated_lines: -1 })],
  ["a difficulty of medium", json({ parts: [{ id: "01", difficulty: "medium" }] })],
  ["a part without an id", json({ parts: [{ difficulty: "easy" }] })],
  ["text that is not JSON", "not json"],
  ["JSON that is not an object", "[1]"],
])("parsePlan refuses %s with bad-plan", (_name, text) => {
  expect(() => parsePlan(text)).toThrow(expect.objectContaining({ code: "bad-plan" }));
  expect(readPlan(text)).toBeNull();
});
