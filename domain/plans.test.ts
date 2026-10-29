import { expect, test } from "bun:test";
import type { Recipe } from "./groups.ts";
import { taskId } from "./ids.ts";
import {
  checkPlanMd,
  docsPlanOf,
  PLAN_MD_MAX_LINES,
  type PlanResult,
  parsePlan,
  planLines,
  type Question,
  readPlan,
  renderDocsPart,
  renderDocsPlanMd,
} from "./plans.ts";
import type { Task } from "./tasks.ts";

const PLAN_FILE = "/t/.tenbox/plan.json";

const example = { part: "01", title: "lists the tasks", before: "GET /tasks", after: "200 []" };
const decision = {
  title: "Where the list lives",
  options: ["in memory", "in sqlite"],
  taken: 2,
  reason: "it must survive a restart",
};
const valid: PlanResult = {
  kind: "normal",
  summary: "s",
  estimated_lines: 120,
  parts: [
    { id: "01", difficulty: "easy" },
    { id: "02", difficulty: "hard" },
  ],
  examples: [example],
  decisions: [decision],
  lenses: ["contract"],
  questions: [{ kind: "product", text: "q", blocking: false }],
};
const json = (change: Record<string, unknown>): string => JSON.stringify({ ...valid, ...change });
const { examples: _examples, ...withoutExamples } = valid;

test("parsePlan returns the plan result", () => {
  expect(parsePlan(json({}))).toEqual(valid);
});

test("readPlan returns the plan result of plan.json", () => {
  expect(readPlan(json({}), PLAN_FILE)).toEqual(valid);
});

test("the bad-input message names the field", () => {
  expect(() => parsePlan(json({ estimated_lines: "about 300" }))).toThrow("estimated_lines: ");
});

test.each([
  ["lines that are text", json({ estimated_lines: "about 300" })],
  ["a negative number of lines", json({ estimated_lines: -1 })],
  ["a difficulty of medium", json({ parts: [{ id: "01", difficulty: "medium" }] })],
  ["a part without an id", json({ parts: [{ difficulty: "easy" }] })],
  ["text that is not JSON", "not json"],
  ["JSON that is not an object", "[1]"],
  ["criteria and no examples", JSON.stringify({ ...withoutExamples, criteria: ["c"] })],
  ["no decisions", JSON.stringify({ ...valid, decisions: undefined })],
  [
    "an example of a part that is not in the plan",
    json({ examples: [{ ...example, part: "09" }] }),
  ],
  ["an example without an after", json({ examples: [{ ...example, after: "" }] })],
  ["an example with grep", json({ examples: [{ ...example, after: "run grep -r foo src" }] })],
  ["an example title with GREP", json({ examples: [{ ...example, title: "GREP finds it" }] })],
  ["a taken option above the options", json({ decisions: [{ ...decision, taken: 3 }] })],
  ["a taken option of 0", json({ decisions: [{ ...decision, taken: 0 }] })],
  ["a decision with one option", json({ decisions: [{ ...decision, options: ["a"], taken: 1 }] })],
  ["a decision without a reason", json({ decisions: [{ ...decision, reason: "" }] })],
])("parsePlan refuses %s with bad-input, readPlan with bad-file", (_name, text) => {
  expect(() => parsePlan(text)).toThrow(expect.objectContaining({ code: "bad-input" }));
  expect(() => readPlan(text, PLAN_FILE)).toThrow(expect.objectContaining({ code: "bad-file" }));
});

test("the bad-input message names the grep example", () => {
  const examples = [{ ...example, before: "run grep -r foo src" }];
  expect(() => parsePlan(json({ examples }))).toThrow("run grep -r foo src");
});

test("the bad-input message names the unknown part of an example", () => {
  expect(() => parsePlan(json({ examples: [{ ...example, part: "09" }] }))).toThrow("09");
});

test("a word that only contains grep is allowed", () => {
  const examples = [{ ...example, after: "fingrepair works" }];
  expect(parsePlan(json({ examples })).examples).toEqual(examples);
});

const planMd = (lines: number): string => "line\n".repeat(lines);

test("checkPlanMd accepts a plan.md at the limit", () => {
  expect(PLAN_MD_MAX_LINES).toBe(60);
  expect(() => checkPlanMd({ dir: "/t/.tenbox", planMd: planMd(PLAN_MD_MAX_LINES) })).not.toThrow();
});

test("checkPlanMd refuses a plan.md over the limit with bad-file naming plan.md and the limit", () => {
  const texts = { dir: "/t/.tenbox", planMd: planMd(PLAN_MD_MAX_LINES + 1) };
  expect(() => checkPlanMd(texts)).toThrow(expect.objectContaining({ code: "bad-file" }));
  expect(() => checkPlanMd(texts)).toThrow(
    "/t/.tenbox/plan.md is not valid: 61 lines; the limit is 60",
  );
});

test("checkPlanMd counts a last line without a newline", () => {
  const texts = { dir: "/t/.tenbox", planMd: `${planMd(60)}last` };
  expect(() => checkPlanMd(texts)).toThrow("61 lines");
});

test("checkPlanMd refuses a missing plan.md with no-plan", () => {
  const texts = { dir: "/t/.tenbox", planMd: null };
  expect(() => checkPlanMd(texts)).toThrow(expect.objectContaining({ code: "no-plan" }));
});

test("planLines lists the parts, the examples, the decisions with the taken option and the questions", () => {
  const question: Question = { kind: "risk", text: "q?", blocking: true };
  const plan = { ...valid, questions: [question] };
  expect(planLines(plan)).toEqual([
    "Parts",
    "  01 (easy)",
    "  02 (hard)",
    "Examples",
    "  01 · lists the tasks",
    "    before: GET /tasks",
    "    after: 200 []",
    "Decisions",
    "  Where the list lives",
    "      1. in memory",
    "    * 2. in sqlite (taken)",
    "    reason: it must survive a restart",
    "Questions",
    "  [risk] (blocking) q?",
  ]);
});

test("planLines indents every line of a before or after with more lines", () => {
  const plan = { ...valid, examples: [{ ...example, after: "200\n[]" }] };
  expect(planLines(plan)).toContain("           []");
  expect(planLines(plan)).toContain("    after: 200");
});

test("planLines says none for an empty list", () => {
  const plan = { ...valid, examples: [], decisions: [], questions: [] };
  expect(planLines(plan).slice(3)).toEqual([
    "Examples",
    "  none",
    "Decisions",
    "  none",
    "Questions",
    "  none",
  ]);
});
const recipe: Recipe = {
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
])("parsePlan refuses groups with %s with bad-input, readPlan with bad-file", (_name, groups) => {
  const text = json({ groups });
  expect(() => parsePlan(text)).toThrow(expect.objectContaining({ code: "bad-input" }));
  expect(() => readPlan(text, PLAN_FILE)).toThrow(expect.objectContaining({ code: "bad-file" }));
});

test("the bad-input message names the part that is in no group", () => {
  expect(() => parsePlan(json({ groups: [group(1, ["01"], [])] }))).toThrow("02");
});

test("parts accept files or none", () => {
  const withFiles: PlanResult = {
    ...valid,
    parts: [{ id: "01", difficulty: "easy", files: ["a.ts"] }],
  };
  const without: PlanResult = { ...valid, parts: [{ id: "02", difficulty: "easy" }], examples: [] };
  expect(parsePlan(JSON.stringify(withFiles)).parts).toEqual(withFiles.parts);
  expect(parsePlan(JSON.stringify(without)).parts).toEqual(without.parts);
});

test("parsePlan keeps the kind of the plan", () => {
  expect(parsePlan(json({ kind: "small" })).kind).toBe("small");
});

test("parsePlan refuses an unknown kind with bad-input", () => {
  expect(() => parsePlan(json({ kind: "tiny" }))).toThrow(
    expect.objectContaining({ code: "bad-input" }),
  );
});

test("a plan without a kind is normal", () => {
  expect(parsePlan(json({})).kind).toBe("normal");
});

test("the plan of a docs task is one easy part with nothing to decide", () => {
  const task: Task = {
    id: taskId("T-1"),
    title: "Fix the README",
    description: "",
    url: "",
    status: "todo",
    tracker: "none",
    comments: [],
  };
  expect(docsPlanOf(task)).toEqual({
    kind: "docs",
    summary: "Fix the README",
    estimated_lines: 0,
    parts: [{ id: "01", difficulty: "easy" }],
    examples: [],
    decisions: [],
    lenses: [],
    questions: [],
  });
  expect(renderDocsPlanMd(task)).toBe("# T-1 · Fix the README\n\nFix the README\n");
  expect(renderDocsPart()).toStartWith("# 01 · docs\nstatus: todo\n");
});
