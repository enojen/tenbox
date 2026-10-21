import { describe, expect, test } from "bun:test";
import { taskId } from "./ids.ts";
import { projectName, taskWorktreeDir, taskWorktreeNames } from "./project.ts";

describe("projectName", () => {
  test("tenbox.yaml project: wins", () => {
    expect(projectName("/x/api", "billing")).toBe("billing");
  });
  test("falls back to the checkout's directory name", () => {
    expect(projectName("/x/api", undefined)).toBe("api");
  });
  test("uses the parent's name when the checkout is main", () => {
    expect(projectName("/home/u/wt/tenbox-demo/main", undefined)).toBe("tenbox-demo");
  });
});

test("taskWorktreeDir sits next to main", () => {
  expect(taskWorktreeDir("/home/u/wt", "tenbox-demo", taskId("DEMO-1"))).toBe(
    "/home/u/wt/tenbox-demo/DEMO-1",
  );
});

test("taskWorktreeNames leaves out main and the group worktrees of another name in the list", () => {
  const names = ["main", "T-1", "T-1-2", "T-1-3", "TEN-407", "TEN-12", "notes"];
  expect(taskWorktreeNames(names)).toEqual(["T-1", "TEN-407", "TEN-12", "notes"]);
});
