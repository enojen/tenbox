import { expect, test } from "bun:test";
import { outboxEvent, taskStarted } from "./event.ts";
import { projectId, taskId } from "./ids.ts";

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

test("an outbox event is any JSON, and a text that is not JSON is undefined", () => {
  expect(outboxEvent('{"type":"task.paused"}\n')).toEqual({ type: "task.paused" });
  expect(outboxEvent("{not json")).toBeUndefined();
});
