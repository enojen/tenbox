import { afterEach, expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { taskId } from "../../domain/ids.ts";
import { taskDir } from "../../domain/project.ts";
import { manifests } from "../application/manifests.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { type FakeClaude, makeFakeClaude, notificationHooks, tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { type StartInput, startTask } from "./start.ts";

let project: TempProject;
let taskWorktree: string;
let startCwd: string;
const startPath = process.env.PATH;

const input = (extra: Partial<StartInput> = {}): StartInput => ({
  id: taskId("T-1"),
  title: "Cancel",
  base: undefined,
  claude: false,
  setup: true,
  kind: undefined,
  ...extra,
});
const taskMdPath = (): string => path.join(taskWorktree, ".tenbox", "task.md");
const settingsPath = (): string => path.join(project.mainDir, ".claude", "settings.local.json");
async function readSettings(): Promise<Record<string, unknown>> {
  const text = await files.read(settingsPath());
  return JSON.parse(text ?? "null");
}

/** A committed manifest; `id: false` commits one without a project id, so start has to write it. */
async function setup(manifest: string, id = true): Promise<void> {
  project = await makeTempProject({ "tenbox.yaml": manifest });
  if (!id) {
    await files.write(path.join(project.mainDir, "tenbox.yaml"), manifest);
    await git.run(["commit", "-q", "-am", "no id"], project.mainDir);
  }
  taskWorktree = path.join(project.wtRoot, "demo", "T-1");
  startCwd = process.cwd();
  process.chdir(project.mainDir);
}

afterEach(async () => {
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
  expect([r.tracker.status, r.claude.state]).toEqual(["skipped", "skipped"]);
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

async function useFakeClaude(): Promise<FakeClaude> {
  const fake = await makeFakeClaude(project.root);
  process.env.PATH = fake.env.PATH;
  return fake;
}

test("starts claude --bg with the plan in the task worktree", async () => {
  await setup("project: demo\n");
  const fake = await useFakeClaude();
  const r = await startTask(input({ claude: true, setup: false }));
  const id = await manifests.ensureId(project.mainDir);
  const dir = taskDir(project.tenboxHome, id, taskId("T-1"));
  const real = await files.realPath(taskWorktree);
  const calls = await fake.calls();
  expect(r.claude).toEqual({ session: "tenbox-T-1", state: "started" });
  const args = calls.at(-1)?.args ?? [];
  const at = args.indexOf("--settings");
  expect(calls.at(-1)?.cwd).toBe(real);
  expect(args.slice(0, at)).toEqual(["--bg", "--model", "sonnet", "--add-dir", dir]);
  expect(args.slice(at + 2)).toEqual([
    "-n",
    "tenbox-T-1",
    "--allowedTools",
    "Workflow",
    "--",
    "/tenbox-plan T-1",
  ]);
});

test("starts claude with a Notification hook for permission prompts that runs hook blocked", async () => {
  await setup("project: demo\n");
  const fake = await useFakeClaude();
  await startTask(input({ claude: true, setup: false }));
  const calls = await fake.calls();
  const hooks = notificationHooks(calls.at(-1)?.args ?? []);
  expect(hooks?.Notification.map((entry) => entry.matcher)).toEqual(["permission_prompt"]);
  const [entry] = hooks?.Notification ?? [];
  expect(entry?.hooks.map((hook) => hook.type)).toEqual(["command"]);
  expect(entry?.hooks[0]?.command.endsWith(" hook blocked T-1")).toBe(true);
});

test("a background session in the task worktree is kept: exists, no second claude --bg", async () => {
  await setup("project: demo\n");
  await startTask(input({ setup: false }));
  const fake = await useFakeClaude();
  const real = await files.realPath(taskWorktree);
  await fake.setSessions([{ id: "bg1", cwd: real, kind: "background", startedAt: 1, pid: 11 }]);
  const r = await startTask(input({ claude: true, setup: false }));
  const calls = await fake.calls();
  expect(r.claude.state).toBe("exists");
  expect(calls.map((call) => call.args[0])).toEqual(["agents"]);
});

test("the manifest model goes to claude --model", async () => {
  await setup("project: demo\nmodel: opus\n");
  const fake = await useFakeClaude();
  await startTask(input({ claude: true, setup: false }));
  const calls = await fake.calls();
  expect(calls.at(-1)?.args.slice(0, 3)).toEqual(["--bg", "--model", "opus"]);
});

test("without claude in PATH the claude step is unavailable", async () => {
  await setup("project: demo\n");
  const gitOnly = path.join(project.root, "git-bin");
  await files.mkdir(gitOnly);
  await files.symlink(Bun.which("git") ?? "git", path.join(gitOnly, "git"));
  process.env.PATH = gitOnly;
  const r = await startTask(input({ claude: true, setup: false }));
  expect(r.claude.state).toBe("unavailable");
});

test("a claude --bg that fails, as on an untrusted workspace, fails start with its message", async () => {
  await setup("project: demo\n");
  const fake = await useFakeClaude();
  await fake.failWith("Workspace not trusted. Run `claude` once.");
  await expect(startTask(input({ claude: true, setup: false }))).rejects.toMatchObject({
    code: "claude",
    message: expect.stringContaining("Workspace not trusted"),
  });
});

test("invalid settings.local.json fails with code settings naming the file", async () => {
  await setup("project: demo\n");
  await files.write(settingsPath(), "{bad");
  await expect(startTask(input())).rejects.toMatchObject({
    code: "settings",
    message: expect.stringContaining(settingsPath()),
  });
});

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

const NOT_COMMITTED = "commit tenbox.yaml on main";

test("a tenbox.yaml without an id gets one, start stops, and works after the commit", async () => {
  const before = "# keep me\nproject: demo\n";
  await setup(before, false);
  const yamlPath = path.join(project.mainDir, "tenbox.yaml");
  await expect(startTask(input({ setup: false }))).rejects.toMatchObject({
    code: "manifest-not-committed",
    message: expect.stringContaining(NOT_COMMITTED),
  });
  const written = await files.read(yamlPath);
  const created = await files.isDir(taskWorktree);
  expect(written).toMatch(/^# keep me\nproject: demo\nid: "[a-z0-9]{6}"\n$/);
  expect(created).toBe(false);
  await git.run(["commit", "-q", "-am", "id"], project.mainDir);
  const second = await startCapturingStderr({ id: taskId("T-2") });
  const after = await files.read(yamlPath);
  expect(after).toBe(written);
  expect(second).not.toContain("commit tenbox.yaml");
});

test("an untracked tenbox.yaml stops start before the worktree", async () => {
  await setup("project: demo\nid: k7f3qa\n");
  await git.run(["rm", "-q", "--cached", "tenbox.yaml"], project.mainDir);
  await git.run(["commit", "-q", "-m", "untrack"], project.mainDir);
  await expect(startTask(input({ setup: false }))).rejects.toMatchObject({
    code: "manifest-not-committed",
    message: expect.stringContaining(NOT_COMMITTED),
  });
  const created = await files.isDir(taskWorktree);
  expect(created).toBe(false);
});

test("a modified tenbox.yaml stops start before the worktree", async () => {
  await setup("project: demo\nid: k7f3qa\n");
  await files.write(
    path.join(project.mainDir, "tenbox.yaml"),
    "project: demo\nid: k7f3qa\nbase: main\n",
  );
  await expect(startTask(input({ setup: false }))).rejects.toMatchObject({
    code: "manifest-not-committed",
    message: expect.stringContaining(NOT_COMMITTED),
  });
  const created = await files.isDir(taskWorktree);
  expect(created).toBe(false);
});

test("start keeps a tenbox.yaml that already has an id", async () => {
  const before = "project: demo\nid: k7f3qa\n";
  await setup(before);
  const stderr = await startCapturingStderr();
  const text = await files.read(path.join(project.mainDir, "tenbox.yaml"));
  expect(text).toBe(before);
  expect(stderr).not.toContain("commit tenbox.yaml");
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

test("task.md has no status line", async () => {
  await setup(ID_MANIFEST);
  await startTask(input({ setup: false }));
  const taskMd = await files.read(taskMdPath());
  expect(taskMd).not.toContain("status:");
});

test("task.json holds the task, and a second start keeps an edited one", async () => {
  await setup(ID_MANIFEST);
  await startTask(input({ setup: false }));
  const taskJson = path.join(taskDirPath(), "task.json");
  const first = await files.read(taskJson);
  expect(JSON.parse(first ?? "null")).toEqual({
    id: "T-1",
    title: "Cancel",
    status: "started",
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

/** A fake ClickUp API: the task, its list and the given comments. */
function fakeClickup(comments: unknown[]): void {
  const saved = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/comment")) return Response.json({ comments });
      if (path.includes("/list/")) return Response.json({ statuses: [] });
      return Response.json({
        id: "T-1",
        name: "Cancel",
        markdown_description: "body",
        url: "u",
        status: { status: "Open" },
        list: { id: "9" },
      });
    },
    { preconnect: saved.preconnect },
  );
}

const CLICKUP_MANIFEST = "project: demo\ntracker: { kind: clickup, api_key: k }\n";

test("a tracker task with comments gets a Comments section, oldest first", async () => {
  const saved = globalThis.fetch;
  await setup(CLICKUP_MANIFEST);
  fakeClickup([
    { comment_text: "newer", user: { username: "bob" }, date: "1767312000000" },
    { comment_text: "older", user: { username: "ann" }, date: "1767225600000" },
  ]);
  try {
    await startTask(input({ title: undefined, setup: false }));
  } finally {
    globalThis.fetch = saved;
  }
  const taskMd = await files.read(taskMdPath());
  expect(taskMd).toEndWith(
    "\n## Comments\n\n### ann · 2026-01-01T00:00:00.000Z\n\nolder\n" +
      "\n### bob · 2026-01-02T00:00:00.000Z\n\nnewer\n",
  );
  const taskJson = await files.read(path.join(taskDirPath(), "task.json"));
  expect(taskJson).not.toContain("comments");
});

test("a tracker task without comments, or started with a title, has no Comments section", async () => {
  const saved = globalThis.fetch;
  await setup(CLICKUP_MANIFEST);
  fakeClickup([]);
  try {
    await startTask(input({ title: undefined, setup: false }));
  } finally {
    globalThis.fetch = saved;
  }
  const withoutComments = await files.read(taskMdPath());
  await rm(taskDirPath(), { recursive: true, force: true });
  await startTask(input({ setup: false }));
  const withTitle = await files.read(taskMdPath());
  expect([withoutComments, withTitle].join("")).not.toContain("## Comments");
});

test("--kind tiny is a usage error and makes no worktree", async () => {
  await setup("project: demo\n");
  const run = await tenbox(
    ["start", "T-1", "--title", "x", "--kind", "tiny", "--no-claude", "--no-setup"],
    project.mainDir,
  );
  const made = await files.exists(taskWorktree);
  expect([run.code, run.json.code, made]).toEqual([2, "usage", false]);
});

test("--kind small is saved in task.json", async () => {
  await setup("project: demo\n");
  await startTask(input({ kind: "small" }));
  const text = await files.read(path.join(taskWorktree, ".tenbox", "task.json"));
  expect(JSON.parse(text ?? "null")).toMatchObject({ id: "T-1", kind: "small" });
});

test("--kind docs writes the plan and starts no session", async () => {
  await setup("project: demo\n");
  const r = await startTask(input({ kind: "docs", claude: true, title: "Fix typo" }));
  const dir = path.join(taskWorktree, ".tenbox");
  const planText = await files.read(path.join(dir, "plan.json"));
  const plan = JSON.parse(planText ?? "null");
  const planMd = await files.read(path.join(dir, "plan.md"));
  const hasPart = await files.exists(path.join(dir, "parts", "01-docs.md"));
  expect(r.claude.state).toBe("skipped");
  expect(plan).toMatchObject({
    kind: "docs",
    parts: [{ id: "01", difficulty: "easy" }],
    examples: [],
    decisions: [],
    questions: [],
  });
  expect(planMd).toContain("# T-1 · Fix typo");
  expect(hasPart).toBe(true);
  const approved = await tenbox(["approve", "T-1"], project.mainDir);
  expect([approved.code, approved.json.ok]).toEqual([0, true]);
});
