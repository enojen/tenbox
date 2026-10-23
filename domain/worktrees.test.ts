import { expect, test } from "bun:test";
import { taskId } from "./ids.ts";
import { taskWorktreeDir, taskWorktreeNames } from "./worktrees.ts";

test("taskWorktreeDir sits next to main", () => {
  expect(taskWorktreeDir("/home/u/wt", "tenbox-demo", taskId("DEMO-1"))).toBe(
    "/home/u/wt/tenbox-demo/DEMO-1",
  );
});

test("taskWorktreeNames leaves out main and the group worktrees of another name in the list", () => {
  const names = ["main", "T-1", "T-1-2", "T-1-3", "TEN-407", "TEN-12", "notes"];
  expect(taskWorktreeNames(names)).toEqual(["T-1", "TEN-407", "TEN-12", "notes"]);
});
