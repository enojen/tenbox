import { expect, test } from "bun:test";
import { type PlanResult, parsePlan, readPlan } from "./plan.ts";

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
  ["a criterion with grep", json({ criteria: ["ok", "run grep -r foo src"] })],
  ["a criterion with GREP in upper case", json({ criteria: ["GREP finds nothing"] })],
])("parsePlan refuses %s with bad-plan", (_name, text) => {
  expect(() => parsePlan(text)).toThrow(expect.objectContaining({ code: "bad-plan" }));
  expect(readPlan(text)).toBeNull();
});

test("the bad-plan message names the grep criterion", () => {
  expect(() => parsePlan(json({ criteria: ["run grep -r foo src"] }))).toThrow(
    "run grep -r foo src",
  );
});

test("a word that only contains grep is allowed", () => {
  expect(parsePlan(json({ criteria: ["fingrepair works"] })).criteria).toEqual([
    "fingrepair works",
  ]);
});

const recipe: NonNullable<PlanResult["groups"]>[number]["recipe"] = {
  model: "sonnet",
  effort: "medium",
  lenses: [],
  tier: "fast",
};
const group = (id: number, parts: string[], needs: number[]) => ({
  id,
  name: `feat: group ${id}`,
  parts,
  needs,
  recipe,
});
const twoGroups = [group(1, ["01"], []), group(2, ["02"], [1])];

test("parsePlan keeps the groups", () => {
  expect(parsePlan(json({ groups: twoGroups })).groups).toEqual(twoGroups);
});

test("a recipe may name the fable model", () => {
  const groups = [group(1, ["01", "02"], [])].map((g) => ({
    ...g,
    recipe: { ...recipe, model: "fable" },
  }));
  expect(parsePlan(json({ groups })).groups?.[0]?.recipe.model).toBe("fable");
});

test.each([
  ["a part in no group", [group(1, ["01"], [])]],
  ["a part in two groups", [group(1, ["01", "02"], []), group(2, ["02"], [1])]],
  ["an unknown part id", [group(1, ["01", "09"], []), group(2, ["02"], [1])]],
  ["group ids out of order", [group(2, ["01"], []), group(1, ["02"], [])]],
  ["group ids that start at 2", [group(2, ["01", "02"], [])]],
  ["a need that is the group itself", [group(1, ["01"], []), group(2, ["02"], [2])]],
  ["a need with a larger id", [group(1, ["01"], [2]), group(2, ["02"], [])]],
  ["a group without a name", [group(1, ["01"], []), { ...group(2, ["02"], [1]), name: "" }]],
  [
    "an unknown model",
    [group(1, ["01"], []), { ...group(2, ["02"], [1]), recipe: { ...recipe, model: "gpt" } }],
  ],
  [
    "an unknown effort",
    [group(1, ["01"], []), { ...group(2, ["02"], [1]), recipe: { ...recipe, effort: "max" } }],
  ],
  [
    "an unknown lens",
    [group(1, ["01"], []), { ...group(2, ["02"], [1]), recipe: { ...recipe, lenses: ["perf"] } }],
  ],
  [
    "an unknown tier",
    [group(1, ["01"], []), { ...group(2, ["02"], [1]), recipe: { ...recipe, tier: "slow" } }],
  ],
])("parsePlan refuses groups with %s with bad-plan", (_name, groups) => {
  const text = json({ groups });
  expect(() => parsePlan(text)).toThrow(expect.objectContaining({ code: "bad-plan" }));
  expect(readPlan(text)).toBeNull();
});

test("the bad-plan message names the part that is in no group", () => {
  expect(() => parsePlan(json({ groups: [group(1, ["01"], [])] }))).toThrow("02");
});

test("parts accept files or none", () => {
  const withFiles: PlanResult = {
    ...valid,
    parts: [{ id: "01", difficulty: "easy", files: ["a.ts"] }],
  };
  const without: PlanResult = { ...valid, parts: [{ id: "02", difficulty: "easy" }] };
  expect(parsePlan(JSON.stringify(withFiles)).parts).toEqual(withFiles.parts);
  expect(parsePlan(JSON.stringify(without)).parts).toEqual(without.parts);
});
