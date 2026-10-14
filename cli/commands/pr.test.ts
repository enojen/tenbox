import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
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
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
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

test("the PR title comes from task.json, not task.md", async () => {
  const dir = path.join(taskWorktree, ".tenbox");
  const taskText = await files.read(path.join(dir, "task.json"));
  const taskJson = JSON.parse(taskText ?? "null");
  await files.write(path.join(dir, "task.json"), JSON.stringify({ ...taskJson, title: "y" }));
  await files.write(path.join(taskWorktree, "b.txt"), "b\n");
  await git.run(["add", "b.txt"], taskWorktree);
  await git.run(["commit", "-q", "-m", "b"], taskWorktree);
  const bin = path.join(project.root, "bin");
  const log = path.join(project.root, "gh.log");
  const script = `#!/bin/sh
printf '%s\\n' "$@" >> "${log}"
if [ "$1 $2" = "pr list" ]; then
  if [ -f "${log}.created" ]; then echo '[{"number":1,"url":"u","isDraft":true}]'; else echo '[]'; fi
fi
if [ "$1 $2" = "pr create" ]; then touch "${log}.created"; fi
`;
  await files.write(path.join(bin, "gh"), script);
  await chmod(path.join(bin, "gh"), 0o755);
  const run = await tenbox(["pr", "T-1"], project.mainDir, {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  });
  const logged = await files.read(log);
  expect([run.code, run.json.ok]).toEqual([0, true]);
  expect((logged ?? "").split("\n")).toContain("T-1 · y");
});
