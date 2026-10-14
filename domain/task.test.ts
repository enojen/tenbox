import { expect, test } from "bun:test";
import { taskId } from "./ids.ts";
import {
  nextRound,
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
  });
  expect(md).toBe("# T-1 · Cancel\n\nstatus: todo\ntracker: none\nurl: -\n\n(no description)\n");
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
  };
  expect(taskFileOf(task)).toEqual({
    id: "T-1",
    title: "Cancel",
    status: "todo",
    tracker: "none",
    url: null,
  });
  expect(taskFileOf({ ...task, url: "https://x/T-1" }).url).toBe("https://x/T-1");
});

test("readTaskFile reads task.json and gives null for anything else", () => {
  const file: TaskFile = { id: "T-1", title: "y", status: "todo", tracker: "none", url: null };
  expect(readTaskFile(JSON.stringify(file))).toEqual(file);
  expect(readTaskFile('{"id":"T-1"}')).toBeNull();
  expect(readTaskFile("not json")).toBeNull();
});
