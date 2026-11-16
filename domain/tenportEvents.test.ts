import { expect, test } from "bun:test";
import { projectId, taskId } from "./ids.ts";
import { outboxText, readOutboxLines, taskClosed, taskStarted } from "./tenportEvents.ts";

const TITLE_MAX_CHARS = 200;
const task = { project: projectId("k7f3qa"), task: taskId("TEN-1") };

test("a started task keeps a trimmed title and an http link", () => {
  const body = taskStarted({ ...task, title: "  Login page ", url: "https://linear.app/x/TEN-1" });
  expect(body).toEqual({
    type: "task.started",
    project: "k7f3qa",
    task: "TEN-1",
    title: "Login page",
    url: "https://linear.app/x/TEN-1",
  });
});

test("an empty title and a link that is not http are left out", () => {
  const body = taskStarted({ ...task, title: "   ", url: "" });
  const ftp = taskStarted({ ...task, title: "x", url: "ftp://host/TEN-1" });
  expect(body).toEqual({ type: "task.started", project: "k7f3qa", task: "TEN-1" });
  expect(ftp).not.toHaveProperty("url");
});

test("a long title is cut to the characters Tenport keeps", () => {
  const body = taskStarted({ ...task, title: "ç".repeat(TITLE_MAX_CHARS + 1), url: "" });
  expect(body).toHaveProperty("title", "ç".repeat(TITLE_MAX_CHARS));
});

test("the outbox reads back what it wrote", () => {
  const event = { id: "e1", at: "2026-11-16T20:00:00.000Z", ...taskClosed(task) };
  const text = outboxText([event, event]);
  expect(readOutboxLines(text, "outbox.jsonl")).toEqual([event, event]);
});

test("an outbox line that is not a task event is a bad file", () => {
  const text = '{"type":"task.exploded"}\n';
  expect(() => readOutboxLines(text, "outbox.jsonl")).toThrow("outbox.jsonl");
});
