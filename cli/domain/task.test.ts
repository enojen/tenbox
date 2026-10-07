import { expect, test } from "bun:test";
import { taskId } from "./ids.ts";
import { nextRound, renderTaskMd } from "./task.ts";

test("renderTaskMd", () => {
  const md = renderTaskMd({ id: taskId("T-1"), title: "Cancel", description: "", url: "", status: "todo", tracker: "none" });
  expect(md).toBe("# T-1 · Cancel\n\nstatus: todo\ntracker: none\nurl: -\n\n(no description)\n");
});

test("nextRound", () => {
  expect(nextRound([])).toBe(1);
  expect(nextRound(["1", "2", "junk", "10"])).toBe(11);
});
