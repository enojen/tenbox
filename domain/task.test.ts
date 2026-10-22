import { expect, test } from "bun:test";
import { taskId } from "./ids.ts";
import {
  nextRound,
  readGroupStart,
  readTaskFile,
  renderTaskMd,
  type Task,
  type TaskFile,
  taskFileOf,
} from "./task.ts";

test("renderTaskMd", () => {
  const md = renderTaskMd({
    id: taskId("T-1"),
    title: "Cancel",
    description: "",
    url: "",
    status: "todo",
    tracker: "none",
    comments: [],
  });
  expect(md).toBe("# T-1 · Cancel\n\ntracker: none\nurl: -\n\n(no description)\n");
});

test("nextRound", () => {
  expect(nextRound([])).toBe(1);
  expect(nextRound(["1", "2", "junk", "10"])).toBe(11);
});

test("taskFileOf keeps the title and gives a task without url a null url", () => {
  const task: Task = {
    id: taskId("T-1"),
    title: "Cancel",
    description: "d",
    url: "",
    status: "todo",
    tracker: "none",
    comments: [],
  };
  expect(taskFileOf(task, undefined)).toEqual({
    id: "T-1",
    title: "Cancel",
    status: "started",
    tracker: "none",
    url: null,
  });
  expect(taskFileOf({ ...task, url: "https://x/T-1" }, undefined).url).toBe("https://x/T-1");
});

test("readTaskFile reads task.json and refuses anything else with bad-file", () => {
  const file: TaskFile = { id: "T-1", title: "y", status: "todo", tracker: "none", url: null };
  const at = "/t/.tenbox/task.json";
  expect(readTaskFile(JSON.stringify(file), at)).toEqual(file);
  expect(() => readTaskFile('{"id":"T-1"}', at)).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
  expect(() => readTaskFile("not json", at)).toThrow(expect.objectContaining({ code: "bad-file" }));
});

test("readGroupStart reads group.json and refuses anything else with bad-file", () => {
  const at = "/t/.tenbox/groups/2/group.json";
  expect(readGroupStart('{"start":"abc123"}', at)).toEqual({ start: "abc123" });
  expect(() => readGroupStart('{"start":1}', at)).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
  expect(() => readGroupStart("not json", at)).toThrow(
    expect.objectContaining({ code: "bad-file" }),
  );
});

test("renderTaskMd appends the comments in order, each with author and date", () => {
  const md = renderTaskMd({
    id: taskId("T-1"),
    title: "Cancel",
    description: "d",
    url: "",
    status: "todo",
    tracker: "linear",
    comments: [
      { author: "ann", date: "2026-01-01T00:00:00.000Z", body: "first" },
      { author: "bob", date: "2026-01-02T00:00:00.000Z", body: "second" },
    ],
  });
  expect(md).toBe(
    "# T-1 · Cancel\n\ntracker: linear\nurl: -\n\nd\n" +
      "\n## Comments\n\n### ann · 2026-01-01T00:00:00.000Z\n\nfirst\n" +
      "\n### bob · 2026-01-02T00:00:00.000Z\n\nsecond\n",
  );
});
