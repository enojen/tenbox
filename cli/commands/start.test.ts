import { afterEach, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { taskId } from "../../domain/ids.ts";
import { files } from "../infra/files.ts";
import { tmuxTest } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { startTask, type StartInput } from "./start.ts";

const SESSION = "tenbox-T-1";

let project: TempProject;
let taskWorktree: string;
let startCwd: string;
const startPath = process.env.PATH;

const input = (extra: Partial<StartInput> = {}): StartInput => ({
  id: taskId("T-1"),
  title: "Cancel",
  tmux: false,
  setup: true,
  ...extra,
});
const taskMdPath = (): string => path.join(taskWorktree, ".tenbox", "task.md");
const settingsPath = (): string => path.join(project.mainDir, ".claude", "settings.local.json");
async function readSettings(): Promise<Record<string, unknown>> {
  const text = await files.read(settingsPath());
  return JSON.parse(text ?? "null");
}

async function setup(manifest: string): Promise<void> {
  project = await makeTempProject({ "tenbox.yaml": manifest });
  taskWorktree = path.join(project.wtRoot, "demo", "T-1");
  startCwd = process.cwd();
  process.chdir(project.mainDir);
}

afterEach(async () => {
  Bun.spawnSync(["tmux", "kill-session", "-t", `=${SESSION}`]);
  process.env.PATH = startPath;
  process.chdir(startCwd);
  await project.remove();
});

test("creates the worktree, .tenbox, excludes, settings and runs setup", async () => {
  await setup("project: demo\nsetup: echo ready > setup.txt\n");
  const r = await startTask(input());
  expect(r).toMatchObject({ created: true, worktree: taskWorktree, branch: "feat/T-1" });
  const taskMd = await files.read(taskMdPath());
  const exclude = await files.read(path.join(project.mainDir, ".git", "info", "exclude"));
  const settings = await readSettings();
  const setupOutput = await files.read(path.join(taskWorktree, "setup.txt"));
  expect(taskMd).toContain("# T-1 · Cancel");
  for (const pattern of [".tenbox/", ".claude/worktrees/", ".claude/settings.local.json"]) {
    expect((exclude ?? "").split("\n")).toContain(pattern);
  }
  expect(settings).toEqual({ worktree: { baseRef: "head" } });
  expect(r.setup).toMatchObject({ state: "ran", cmd: "echo ready > setup.txt", exit_code: 0 });
  expect(setupOutput).toBe("ready\n");
  expect([r.tracker.status, r.tmux.state]).toEqual(["skipped", "skipped"]);
});

test("reuses an existing worktree and keeps task.md and other settings keys", async () => {
  await setup("project: demo\nsetup: echo ready > setup.txt\n");
  await startTask(input({ setup: false }));
  await files.write(taskMdPath(), "# T-1 · Old title\n");
  await files.write(
    settingsPath(),
    '{"worktree":{"baseRef":"head"},"permissions":{"allow":["Bash(git:*)"]}}',
  );
  const r = await startTask(input({ setup: false }));
  expect(r.created).toBe(false);
  const taskMd = await files.read(taskMdPath());
  const settings = await readSettings();
  expect(taskMd).toBe("# T-1 · Old title\n");
  expect(settings.permissions).toEqual({ allow: ["Bash(git:*)"] });
  expect(r.setup).toEqual({ state: "skipped", reason: "--no-setup" });
});

test("without a title and without a tracker it fails with no-tracker", async () => {
  await setup("project: demo\n");
  await expect(startTask(input({ title: undefined }))).rejects.toMatchObject({
    code: "no-tracker",
  });
});

test("a failing setup is an error with the output tail", async () => {
  await setup("project: demo\nsetup: echo broken; exit 3\n");
  await expect(startTask(input())).rejects.toMatchObject({
    code: "setup",
    details: { output: expect.stringContaining("broken") },
  });
});

tmuxTest("starts the tmux session once and then reports exists", async () => {
  await setup("project: demo\n");
  const bin = path.join(project.root, "bin");
  await files.write(path.join(bin, "claude"), "#!/bin/sh\nsleep 30\n");
  await chmod(path.join(bin, "claude"), 0o755);
  process.env.PATH = `${bin}${path.delimiter}${startPath}`;
  const first = await startTask(input({ tmux: true }));
  const second = await startTask(input({ tmux: true }));
  expect([first.tmux.state, second.tmux.state]).toEqual(["started", "exists"]);
});

test("invalid settings.local.json fails with code settings naming the file", async () => {
  await setup("project: demo\n");
  await files.write(settingsPath(), "{bad");
  await expect(startTask(input())).rejects.toMatchObject({
    code: "settings",
    message: expect.stringContaining(settingsPath()),
  });
});
