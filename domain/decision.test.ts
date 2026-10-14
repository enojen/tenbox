import { expect, test } from "bun:test";
import { applyDecisions, parseDecisions } from "./decision.ts";

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
