import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { files } from "../../infra/files.ts";
import { git } from "../../infra/git.ts";
import { type CliRun, tenbox, tmuxTest } from "../../test/cli.ts";
import { makeTempProject, type TempProject } from "../../test/tempProject.ts";

const SESSION = "tenbox-T-1";

let project: TempProject;
let taskWorktree: string;
let archive: string;

async function setup(): Promise<void> {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  taskWorktree = path.join(project.wtRoot, "demo", "T-1");
  archive = path.join(project.wtRoot, ".archive", "demo", "T-1");
  await tenbox(["start", "T-1", "--title", "x", "--no-tmux"], project.mainDir);
}

const closeT1 = (...flags: string[]) => tenbox(["close", "T-1", ...flags], project.mainDir);
const branchList = () => git.run(["branch", "--list", "feat/T-1"], project.mainDir);
const commitOn = async (dir: string, name: string) => {
  await files.write(path.join(dir, name), "x\n");
  await git.run(["add", name], dir);
  await git.run(["commit", "-q", "-m", name], dir);
};

async function expectUntouched(run: CliRun): Promise<void> {
  expect([run.code, run.json.ok]).toEqual([1, false]);
  const worktreeIsDir = await files.isDir(taskWorktree);
  const taskFileExists = await files.exists(path.join(taskWorktree, ".tenbox", "task.md"));
  const archiveExists = await files.exists(archive);
  const branches = await branchList();
  expect(worktreeIsDir).toBe(true);
  expect(taskFileExists).toBe(true);
  expect(archiveExists).toBe(false);
  expect(branches).not.toBe("");
}

afterEach(async () => {
  Bun.spawnSync(["tmux", "kill-session", "-t", `=${SESSION}`]);
  await project.remove();
});

describe("tenbox close", () => {
  test("closes a clean task and removes worktree, branch and .tenbox", async () => {
    await setup();
    const run = await closeT1();
    expect([run.code, run.json.ok]).toEqual([0, true]);
    const archivedTaskExists = await files.exists(path.join(archive, "task.md"));
    const worktreeExists = await files.exists(taskWorktree);
    const worktreeList = await git.run(["worktree", "list"], project.mainDir);
    const branches = await branchList();
    expect(archivedTaskExists).toBe(true);
    expect(worktreeExists).toBe(false);
    expect(worktreeList).not.toContain("T-1");
    expect(branches).toBe("");
  });

  test("a tracked change or an untracked file stops the close", async () => {
    await setup();
    await files.write(path.join(taskWorktree, "a.txt"), "changed\n");
    const trackedRun = await closeT1();
    await expectUntouched(trackedRun);
    await git.run(["checkout", "a.txt"], taskWorktree);
    await files.write(path.join(taskWorktree, "new.txt"), "new\n");
    const untrackedRun = await closeT1();
    await expectUntouched(untrackedRun);
  });

  test("a commit that is not on main stops the close", async () => {
    await setup();
    await commitOn(taskWorktree, "b.txt");
    const run = await closeT1();
    await expectUntouched(run);
  });

  test("a squash-merged branch closes without --force", async () => {
    await setup();
    await commitOn(taskWorktree, "b.txt");
    await git.run(["merge", "--squash", "feat/T-1"], project.mainDir);
    await git.run(["commit", "-q", "-m", "squash"], project.mainDir);
    await commitOn(project.mainDir, "c.txt");
    const run = await closeT1();
    const branches = await branchList();
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(branches).toBe("");
  });

  test("--force closes a dirty and an unmerged task", async () => {
    await setup();
    await commitOn(taskWorktree, "b.txt");
    await files.write(path.join(taskWorktree, "new.txt"), "new\n");
    const run = await closeT1("--force");
    const worktreeExists = await files.exists(taskWorktree);
    const branches = await branchList();
    expect([run.code, run.json]).toMatchObject([0, { ok: true, forced: true }]);
    expect(worktreeExists).toBe(false);
    expect(branches).toBe("");
  });

  test("an existing archive stops the close, also with --force", async () => {
    await setup();
    await files.mkdir(archive);
    const run = await closeT1();
    const worktreeIsDir = await files.isDir(taskWorktree);
    const archivedTaskExists = await files.exists(path.join(archive, "task.md"));
    expect([run.code, run.json.ok]).toEqual([1, false]);
    expect(worktreeIsDir).toBe(true);
    expect(archivedTaskExists).toBe(false);
    const forced = await closeT1("--force");
    const worktreeIsDirAfterForce = await files.isDir(taskWorktree);
    const branches = await branchList();
    expect([forced.code, forced.json.ok]).toEqual([1, false]);
    expect(worktreeIsDirAfterForce).toBe(true);
    expect(branches).not.toBe("");
  });

  test("a second close skips every step", async () => {
    await setup();
    await closeT1();
    const run = await closeT1();
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(run.json).toMatchObject({
      archive: { state: "skipped" },
      tmux: { state: "skipped" },
      worktree: { state: "skipped" },
      branch: { state: "skipped" },
      tracker: { status: "skipped" },
    });
  });

  tmuxTest("kills the tmux session; without tmux in PATH the step is skipped", async () => {
    await setup();
    Bun.spawnSync(["tmux", "new-session", "-d", "-s", SESSION, "sleep 30"]);
    const run = await closeT1();
    expect(run.json).toMatchObject({ tmux: { state: "killed" } });
    expect(Bun.spawnSync(["tmux", "has-session", "-t", `=${SESSION}`]).exitCode).not.toBe(0);
    await rm(archive, { recursive: true });
    await tenbox(["start", "T-1", "--title", "x", "--no-tmux"], project.mainDir);
    const bin = path.join(project.root, "bin");
    await files.mkdir(bin);
    await files.symlink(Bun.which("git") ?? "git", path.join(bin, "git"));
    const noTmux = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
    expect(noTmux.json).toMatchObject({ ok: true, tmux: { state: "skipped" } });
  });

  test("with tracker none the tracker status is skipped", async () => {
    await setup();
    const run = await closeT1();
    expect(run.json).toMatchObject({ tracker: { kind: "none", status: "skipped" } });
  });

  test("works when run from inside the task worktree", async () => {
    await setup();
    const run = await tenbox(["close", "T-1"], taskWorktree);
    const archivedTaskExists = await files.exists(path.join(archive, "task.md"));
    const worktreeExists = await files.exists(taskWorktree);
    const branches = await branchList();
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(archivedTaskExists).toBe(true);
    expect(worktreeExists).toBe(false);
    expect(branches).toBe("");
  });
});
