import { expect, test } from "bun:test";
import { taskId } from "./ids.ts";
import { NamesSchema } from "./manifests.ts";
import { isTaskBranch, sessionName, taskBranch } from "./names.ts";

const defaults = NamesSchema.parse({});

test("derives names from the defaults", () => {
  expect(taskBranch(defaults, taskId("TEN-1"))).toBe("feat/TEN-1");
  expect(sessionName(defaults, taskId("TEN-1"))).toBe("tenbox-TEN-1");
});

test("derives names from custom templates", () => {
  const names = NamesSchema.parse({ branch: "task/{id}-work", session: "{id}" });
  expect(taskBranch(names, taskId("TEN-1"))).toBe("task/TEN-1-work");
  expect(sessionName(names, taskId("TEN-1"))).toBe("TEN-1");
});

test("isTaskBranch is true only for what the branch template makes of a task id", () => {
  const names = NamesSchema.parse({ branch: "task/{id}-work" });
  expect(isTaskBranch(names, "task/TEN-1-work")).toBe(true);
  expect(isTaskBranch(names, "task/a b-work")).toBe(false);
  expect(isTaskBranch(names, "feat/TEN-1")).toBe(false);
});
