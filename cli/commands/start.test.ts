import { afterEach, expect, spyOn, test } from "bun:test";
import { chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { taskId } from "../../domain/ids.ts";
import { taskDir } from "../../domain/project.ts";
import { manifests } from "../application/manifests.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { removeServers, tmux, tmuxTest, waitForText } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import type { StartResult } from "./results.ts";
import { type StartInput, startTask } from "./start.ts";

let project: TempProject;
let taskWorktree: string;
let startCwd: string;
const startPath = process.env.PATH;
const servers: string[] = [];

const input = (extra: Partial<StartInput> = {}): StartInput => ({
  id: taskId("T-1"),
  title: "Cancel",
  base: undefined,
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
  await removeServers(servers);
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
  for (const pattern of [".tenbox", ".claude/worktrees/", ".claude/settings.local.json"]) {
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

test("a second start through a symlinked worktree root reuses the worktree", async () => {
  await setup("project: demo\n");
  const link = path.join(project.root, "link");
  await files.symlink(project.wtRoot, link);
  process.env.TENBOX_WT_ROOT = link;
  const first = await startTask(input({ setup: false }));
  const second = await startTask(input({ setup: false }));
  expect([first.created, second.created]).toEqual([true, false]);
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

/** A fake `claude` that appends its args, one per line, to `<root>/claude.args` and stays up. */
async function useFakeClaude(): Promise<string> {
  const bin = path.join(project.root, "bin");
  const args = path.join(project.root, "claude.args");
  const script = `#!/bin/sh\nprintf '%s\\n' "$@" >> "${args}"\nsleep 30\n`;
  await files.write(path.join(bin, "claude"), script);
  await chmod(path.join(bin, "claude"), 0o755);
  process.env.PATH = `${bin}${path.delimiter}${startPath}`;
  return args;
}

async function startOnServer(extra: Partial<StartInput> = {}): Promise<StartResult> {
  const r = await startTask(input({ tmux: true, ...extra }));
  servers.push(r.tmux.server);
  return r;
}

tmuxTest("starts claude with the plan on the task's own tmux server, once", async () => {
  await setup("project: demo\n");
  const argsFile = await useFakeClaude();
  const first = await startOnServer();
  const second = await startOnServer();
  const id = await manifests.ensureId(project.mainDir);
  const dir = taskDir(project.tenboxHome, id, taskId("T-1"));
  expect([first.tmux.state, second.tmux.state]).toEqual(["started", "exists"]);
  expect(first.tmux.server).toBe(path.join(os.tmpdir(), `tenbox-${id}-T-1`));
  expect(tmux(["has-session", "-t", "=tenbox-T-1"], first.tmux.server).exitCode).toBe(0);
  expect(tmux(["has-session", "-t", "=tenbox-T-1"]).exitCode).not.toBe(0);
  const args = await waitForText(argsFile);
  expect(args.trimEnd().split("\n")).toEqual([
    "--model",
    "sonnet",
    "--add-dir",
    dir,
    "--",
    "/tenbox-plan T-1",
  ]);
});

tmuxTest("the manifest model goes to claude --model", async () => {
  await setup("project: demo\nmodel: opus\n");
  const argsFile = await useFakeClaude();
  await startOnServer();
  const args = await waitForText(argsFile);
  expect(args.split("\n").slice(0, 2)).toEqual(["--model", "opus"]);
});

test("invalid settings.local.json fails with code settings naming the file", async () => {
  await setup("project: demo\n");
  await files.write(settingsPath(), "{bad");
  await expect(startTask(input())).rejects.toMatchObject({
    code: "settings",
    message: expect.stringContaining(settingsPath()),
  });
});

const COMMIT_MESSAGE = "commit tenbox.yaml";

async function startCapturingStderr(extra: Partial<StartInput> = {}): Promise<string> {
  let captured = "";
  const spy = spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    captured += String(chunk);
    return true;
  });
  try {
    await startTask(input({ setup: false, ...extra }));
  } finally {
    spy.mockRestore();
  }
  return captured;
}

test("the first start writes the project id and says to commit; the second changes nothing", async () => {
  const before = "# keep me\nproject: demo\n";
  await setup(before);
  const yamlPath = path.join(project.mainDir, "tenbox.yaml");
  const first = await startCapturingStderr();
  const written = await files.read(yamlPath);
  expect(written).toMatch(/^# keep me\nproject: demo\nid: "[a-z0-9]{6}"\n$/);
  expect(first).toContain(COMMIT_MESSAGE);
  const second = await startCapturingStderr({ id: taskId("T-2") });
  const after = await files.read(yamlPath);
  expect(after).toBe(written);
  expect(second).not.toContain(COMMIT_MESSAGE);
});

test("start keeps a tenbox.yaml that already has an id", async () => {
  const before = "project: demo\nid: k7f3qa\n";
  await setup(before);
  const stderr = await startCapturingStderr();
  const text = await files.read(path.join(project.mainDir, "tenbox.yaml"));
  expect(text).toBe(before);
  expect(stderr).not.toContain(COMMIT_MESSAGE);
});

const TASK_DIR_SUBS = ["parts", "rounds"];
const PROJECT_ID = "k7f3qa";
const ID_MANIFEST = `project: demo\nid: ${PROJECT_ID}\n`;
const taskDirPath = (): string => path.join(project.tenboxHome, PROJECT_ID, "T-1");
const linkPath = (): string => path.join(taskWorktree, ".tenbox");

test("the task dir holds task.md, parts and rounds, and project.json names the project", async () => {
  await setup(ID_MANIFEST);
  await startTask(input({ setup: false }));
  const taskMd = await files.read(path.join(taskDirPath(), "task.md"));
  const projectJson = await files.read(path.join(project.tenboxHome, PROJECT_ID, "project.json"));
  expect(taskMd).toContain("# T-1 · Cancel");
  for (const sub of TASK_DIR_SUBS) {
    const isDir = await files.isDir(path.join(taskDirPath(), sub));
    expect(isDir).toBe(true);
  }
  expect(JSON.parse(projectJson ?? "null")).toEqual({ id: PROJECT_ID, name: "demo" });
});

test("the worktree .tenbox is an absolute link to the task dir and git status stays clean", async () => {
  await setup(ID_MANIFEST);
  await startTask(input({ setup: false }));
  await files.write(path.join(linkPath(), "plan.md"), "plan");
  const target = await files.readLink(linkPath());
  const written = await files.read(path.join(taskDirPath(), "plan.md"));
  const status = await git.run(["status", "--porcelain"], taskWorktree);
  expect(target).toBe(taskDirPath());
  expect(written).toBe("plan");
  expect(status).toBe("");
});

test("a second start keeps the link and an edited task.md", async () => {
  await setup(ID_MANIFEST);
  await startTask(input({ setup: false }));
  await files.write(taskMdPath(), "# T-1 · Edited\n");
  await startTask(input({ setup: false }));
  const target = await files.readLink(linkPath());
  const taskMd = await files.read(path.join(taskDirPath(), "task.md"));
  expect([target, taskMd]).toEqual([taskDirPath(), "# T-1 · Edited\n"]);
});

test("task.json holds the task, and a second start keeps an edited one", async () => {
  await setup(ID_MANIFEST);
  await startTask(input({ setup: false }));
  const taskJson = path.join(taskDirPath(), "task.json");
  const first = await files.read(taskJson);
  expect(JSON.parse(first ?? "null")).toEqual({
    id: "T-1",
    title: "Cancel",
    status: "todo",
    tracker: "none",
    url: null,
  });
  await files.write(taskJson, '{"edited":true}');
  await startTask(input({ setup: false }));
  const second = await files.read(taskJson);
  expect(second).toBe('{"edited":true}');
});

test("a link whose task dir is gone gets the task dir back", async () => {
  await setup(ID_MANIFEST);
  await startTask(input({ setup: false }));
  await rm(taskDirPath(), { recursive: true, force: true });
  await startTask(input({ setup: false }));
  const taskMd = await files.read(path.join(taskDirPath(), "task.md"));
  expect(taskMd).toContain("# T-1 · Cancel");
});

test("a real .tenbox directory is kept and not replaced by a link", async () => {
  await setup(ID_MANIFEST);
  await startTask(input({ setup: false }));
  await rm(linkPath(), { recursive: true, force: true });
  await files.write(path.join(linkPath(), "plan.md"), "old");
  await startTask(input({ setup: false }));
  const target = await files.readLink(linkPath());
  const plan = await files.read(path.join(linkPath(), "plan.md"));
  expect([target, plan]).toEqual([null, "old"]);
});
