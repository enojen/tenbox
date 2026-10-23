import { expect, test } from "bun:test";
import { projectId, taskId } from "./ids.ts";
import {
  approvedFile,
  autoAnswerLog,
  buildFile,
  checkLogFile,
  checkLogsDir,
  checksFile,
  checksFullFile,
  decisionsFile,
  groupDir,
  groupFile,
  groupRoot,
  overrideFile,
  partsDir,
  planFile,
  planMdFile,
  projectDir,
  projectFile,
  proofsFile,
  questionsFile,
  roundDir,
  roundsDir,
  statsFile,
  taskDir,
  taskFile,
  taskMdFile,
  tenboxDir,
} from "./taskDirs.ts";

test("projectDir and taskDir sit under the Tenbox home, by project id", () => {
  const project = projectDir("/h/.tenbox", projectId("k7f3qa"));
  expect(project).toBe("/h/.tenbox/k7f3qa");
  expect(projectFile(project)).toBe("/h/.tenbox/k7f3qa/project.json");
  expect(taskDir("/h/.tenbox", projectId("k7f3qa"), taskId("T-1"))).toBe("/h/.tenbox/k7f3qa/T-1");
});

test("the files of a task dir, reached through .tenbox in the task worktree", () => {
  const dir = tenboxDir("/wt/app/T-1");
  expect(dir).toBe("/wt/app/T-1/.tenbox");
  expect([
    taskFile(dir),
    taskMdFile(dir),
    planFile(dir),
    planMdFile(dir),
    approvedFile(dir),
    buildFile(dir),
    proofsFile(dir),
    statsFile(dir),
    decisionsFile(dir),
    questionsFile(dir),
    overrideFile(dir),
    autoAnswerLog(dir),
    partsDir(dir),
    roundsDir(dir),
  ]).toEqual([
    "/wt/app/T-1/.tenbox/task.json",
    "/wt/app/T-1/.tenbox/task.md",
    "/wt/app/T-1/.tenbox/plan.json",
    "/wt/app/T-1/.tenbox/plan.md",
    "/wt/app/T-1/.tenbox/approved.json",
    "/wt/app/T-1/.tenbox/build.json",
    "/wt/app/T-1/.tenbox/proofs.json",
    "/wt/app/T-1/.tenbox/stats.json",
    "/wt/app/T-1/.tenbox/decisions.md",
    "/wt/app/T-1/.tenbox/questions.md",
    "/wt/app/T-1/.tenbox/override.yaml",
    "/wt/app/T-1/.tenbox/auto-answer.log",
    "/wt/app/T-1/.tenbox/parts",
    "/wt/app/T-1/.tenbox/rounds",
  ]);
});

test("a round holds the check results and one log per check", () => {
  const round = roundDir("/t", 2);
  expect(round).toBe("/t/rounds/2");
  expect(checksFile(round)).toBe("/t/rounds/2/checks.json");
  expect(checksFullFile(round)).toBe("/t/rounds/2/checks-full.json");
  expect(checkLogsDir(round)).toBe("/t/rounds/2/checks");
  expect(checkLogFile(round, "lint")).toBe("/t/rounds/2/checks/lint.log");
});

test("a group holds group.json", () => {
  expect(groupFile(groupDir("/t", 2))).toBe("/t/groups/2/group.json");
});

test("groupRoot is the .tenbox folder for group 1 and groups/N above it", () => {
  expect(groupRoot("/wt/app/T-1", 1)).toBe("/wt/app/T-1/.tenbox");
  expect(groupRoot("/wt/app/T-1", 2)).toBe("/wt/app/T-1/.tenbox/groups/2");
});
