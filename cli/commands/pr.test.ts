import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;
let origin: string;
let taskWorktree: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  origin = await mkdtemp(path.join(os.tmpdir(), "tenbox-origin-"));
  await git.run(["init", "-q", "--bare", origin], project.mainDir);
  await git.run(["remote", "add", "origin", origin], project.mainDir);
  await tenbox(["start", "T-1", "--title", "x", "--no-tmux"], project.mainDir);
  taskWorktree = path.join(project.wtRoot, "demo", "T-1");
});

afterEach(async () => {
  await rm(origin, { recursive: true, force: true });
  await project.remove();
});

const originBranches = () => git.run(["branch", "--list"], origin);

test("a dirty worktree is refused and nothing is pushed", async () => {
  await files.write(path.join(taskWorktree, "new.txt"), "x\n");
  const run = await tenbox(["pr", "T-1"], project.mainDir);
  const branches = await originBranches();
  expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "dirty"]);
  expect(branches).toBe("");
});

test("a branch with no commits ahead of main is refused and nothing is pushed", async () => {
  const run = await tenbox(["pr", "T-1"], project.mainDir);
  const branches = await originBranches();
  expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "no-commits"]);
  expect(branches).toBe("");
});
