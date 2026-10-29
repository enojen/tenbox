import { expect, test } from "bun:test";
import {
  labelsIntoBody,
  newTaskOf,
  parseTaskDraft,
  type TaskDraft,
  taskDraftOf,
} from "./tracker.ts";

const draft: TaskDraft = {
  title: "Add tenbox login",
  why: "A box has no login.",
  what: "Copy the login to the Secret.",
  done: "A Job runs claude with the login.",
  labels: ["feature"],
};

test("newTaskOf renders the house body: Why, What, Done when", () => {
  expect(newTaskOf(draft)).toEqual({
    title: "Add tenbox login",
    body: [
      "**Why**",
      "A box has no login.",
      "",
      "**What**",
      "Copy the login to the Secret.",
      "",
      "**Done when**",
      "A Job runs claude with the login.",
    ].join("\n"),
    labels: ["feature"],
  });
});

test("newTaskOf with an origin ends the body with the task and the tenbox commit", () => {
  const task = newTaskOf(draft, { task: "TEN-301", tenbox: "6a5aae0" });
  expect(task.body.endsWith("\n\nFound by task TEN-301 on tenbox 6a5aae0.")).toBe(true);
});

test("newTaskOf with an origin without a tenbox commit names only the task", () => {
  const task = newTaskOf(draft, { task: "T-1", tenbox: null });
  expect(task.body.endsWith("\n\nFound by task T-1.")).toBe(true);
});

test("newTaskOf with an origin without a task names only the tenbox commit", () => {
  const task = newTaskOf(draft, { task: null, tenbox: "6a5aae0" });
  expect(task.body.endsWith("\n\nFound on tenbox 6a5aae0.")).toBe(true);
});

test("taskDraftOf refuses a draft without a section as bad-input, naming it", () => {
  const { why: _why, ...noWhy } = draft;
  expect(() => taskDraftOf(noWhy)).toThrow(/^the task is not valid: why: /);
  expect(() => taskDraftOf({ ...draft, done: "" })).toThrow(/^the task is not valid: done: /);
});

test("taskDraftOf takes a draft without labels as one with none", () => {
  const { labels: _labels, ...noLabels } = draft;
  expect(taskDraftOf(noLabels)).toEqual({ ...draft, labels: [] });
});

test("parseTaskDraft reads the --json text; not JSON is bad-input", () => {
  expect(parseTaskDraft(JSON.stringify(draft))).toEqual(draft);
  expect(() => parseTaskDraft("{")).toThrow("the task is not valid: not JSON");
});

test("labelsIntoBody moves the labels to the first line of the body; none stays as it is", () => {
  const task = { title: "T", body: "**Why**\nx", labels: ["bug", "agent"] };
  expect(labelsIntoBody(task)).toEqual({
    title: "T",
    body: "Suggested labels: bug, agent\n\n**Why**\nx",
    labels: [],
  });
  const bare = { title: "T", body: "b", labels: [] };
  expect(labelsIntoBody(bare)).toBe(bare);
});
