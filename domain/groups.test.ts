import { expect, test } from "bun:test";
import { groupBranch, groupWorktreeDir, readGroupStart } from "./groups.ts";

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

test("a group above 1 has its own worktree and branch, named after the task's with -N", () => {
  expect(groupWorktreeDir("/wt/app/T-1", 2)).toBe("/wt/app/T-1-2");
  expect(groupBranch("feat/T-1", 2)).toBe("feat/T-1-2");
});
