import { expect, test } from "bun:test";
import { applyDecisions, parseDecisions, takeOptions } from "./decision.ts";
import type { PlanResult } from "./plan.ts";

const QUESTIONS = "## product\n- [ ] (blocking) Can a shipped order be cancelled?\n- [ ] Other?\n";
const texts = { decisions: "", questions: QUESTIONS };

test("a question is answered, ticked and written without checkbox and (blocking)", () => {
  const applied = applyDecisions(
    [{ question: "Can a shipped order be cancelled?", answer: "No" }],
    texts,
  );
  expect(applied.decisions).toBe("- Can a shipped order be cancelled?\n  Answer: No\n");
  expect(applied.questions).toBe(QUESTIONS.replace("- [ ] (blocking)", "- [x] (blocking)"));
  expect([applied.added, applied.ticked]).toEqual([1, 1]);
});

test("a note is appended as one bullet and questions stay as they are", () => {
  const applied = applyDecisions([{ answer: "Use the note" }], {
    decisions: "- old",
    questions: QUESTIONS,
  });
  expect(applied.decisions).toBe("- old\n- Use the note\n");
  expect(applied.questions).toBe(QUESTIONS);
  expect([applied.added, applied.ticked]).toEqual([1, 0]);
});

test("the same items again add and tick nothing", () => {
  const items = [{ question: "Other?", answer: "Yes" }, { answer: "note" }];
  const first = applyDecisions(items, texts);
  const second = applyDecisions(items, first);
  expect(second).toEqual({ ...first, added: 0, ticked: 0 });
});

test("an entry that only starts like an existing one is still added", () => {
  const applied = applyDecisions([{ answer: "note" }], {
    decisions: "- note longer\n",
    questions: "",
  });
  expect(applied.decisions).toBe("- note longer\n- note\n");
});

test.each([
  ["no line", "Missing?"],
  ["two lines", "?"],
])("a question that fits %s is unknown-question", (_name, question) => {
  expect(() => applyDecisions([{ answer: "x" }, { question, answer: "y" }], texts)).toThrow(
    expect.objectContaining({ code: "unknown-question" }),
  );
});

test.each([
  ["not JSON", "{ nope"],
  ["not an array", '{"answer":"x"}'],
  ["a missing answer", '[{"question":"q"}]'],
  ["a blank answer", '[{"answer":"  "}]'],
  ["a newline in the answer", '[{"answer":"a\\nb"}]'],
])("parseDecisions refuses %s with bad-decisions", (_name, text) => {
  expect(() => parseDecisions(text)).toThrow(expect.objectContaining({ code: "bad-decisions" }));
});

test("parseDecisions returns the items", () => {
  expect(parseDecisions('[{"question":"q","answer":"a"},{"answer":"n"}]')).toEqual([
    { question: "q", answer: "a" },
    { answer: "n" },
  ]);
});

test("parseDecisions returns an item that takes an option of a plan decision", () => {
  expect(parseDecisions('[{"decision":"Where","taken":2},{"answer":"n"}]')).toEqual([
    { decision: "Where", taken: 2 },
    { answer: "n" },
  ]);
});

test.each([
  ["a taken of 0", '[{"decision":"Where","taken":0}]'],
  ["a taken that is text", '[{"decision":"Where","taken":"2"}]'],
  ["a blank decision", '[{"decision":" ","taken":1}]'],
])("parseDecisions refuses %s with bad-decisions", (_name, text) => {
  expect(() => parseDecisions(text)).toThrow(expect.objectContaining({ code: "bad-decisions" }));
});

const card = (title: string) => ({
  title,
  options: ["in memory", "in sqlite"],
  taken: 1,
  reason: "r",
});
const plan: PlanResult = {
  summary: "s",
  estimated_lines: 1,
  parts: [{ id: "01", difficulty: "easy" }],
  examples: [],
  decisions: [card("Where the list lives"), card("How the list is sorted")],
  lenses: [],
  questions: [],
};

test("takeOptions sets taken on the one card the text fits and gives its note", () => {
  const taken = takeOptions(plan, [{ decision: "Where the list", taken: 2 }]);
  expect(taken.plan.decisions.map((decision) => decision.taken)).toEqual([2, 1]);
  expect(taken.notes).toEqual([{ answer: "Where the list lives: in sqlite" }]);
  expect(plan.decisions[0]?.taken).toBe(1);
});

test.each([
  ["no card", "Nothing like it"],
  ["two cards", "the list"],
])("a decision that fits %s is unknown-decision", (_name, text) => {
  expect(() => takeOptions(plan, [{ decision: text, taken: 1 }])).toThrow(
    expect.objectContaining({ code: "unknown-decision" }),
  );
});

test("a taken outside the options is bad-decisions and names the card", () => {
  const items = [{ decision: "Where", taken: 3 }];
  expect(() => takeOptions(plan, items)).toThrow(
    expect.objectContaining({ code: "bad-decisions" }),
  );
  expect(() => takeOptions(plan, items)).toThrow("Where the list lives");
});
