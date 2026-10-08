import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { minutesBetween } from "../../domain/utils.ts";
import { projectDir } from "../infra/claudeSessions.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { type CliRun, hasTmux, tenbox, tmuxTest } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const SESSION = "tenbox-T-1";
const MS_PER_MINUTE = 60_000;
const DAY_MS = 86_400_000;
const MARKER = "SECRET-MARKER";

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

/** The archived `stats.json` text; `"null"` when it is missing. */
async function readStatsText(): Promise<string> {
  const text = await files.read(path.join(archive, "stats.json"));
  return text ?? "null";
}

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
  if (hasTmux) Bun.spawnSync(["tmux", "kill-session", "-t", `=${SESSION}`]);
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

  test("writes stats.json with git and task file numbers", async () => {
    await setup();
    const dir = path.join(taskWorktree, ".tenbox");
    await files.write(path.join(dir, "plan.md"), "Estimated lines: 120\n");
    await files.write(path.join(dir, "parts", "01-a.md"), "difficulty: easy\n");
    await files.write(path.join(dir, "parts", "02-b.md"), "difficulty: hard\n");
    await files.write(path.join(dir, "rounds", "1", "checks.json"), '{"ok":false}');
    await files.write(path.join(dir, "rounds", "2", "checks.json"), '{"ok":true}');
    await files.write(path.join(taskWorktree, "src", "a.ts"), "1\n2\n3\n");
    await files.write(path.join(taskWorktree, "src", "a.test.ts"), "1\n2\n");
    await files.write(path.join(taskWorktree, "test", "b.ts"), "1\n");
    await git.run(["add", "src", "test"], taskWorktree);
    await git.run(["commit", "-q", "-m", "code"], taskWorktree);
    await git.run(["rm", "-q", "a.txt"], taskWorktree);
    await git.run(["commit", "-q", "-m", "rm"], taskWorktree);
    await git.run(["config", "user.email", "me@example.com"], project.mainDir);
    const run = await closeT1("--force");
    const text = await readStatsText();
    const written = JSON.parse(text);
    expect(run.json).toMatchObject({
      stats: { path: path.join(archive, "stats.json"), state: "written" },
    });
    expect(written).toMatchObject({
      schema: 3,
      project: "demo",
      task: "T-1",
      title: "x",
      user: "me@example.com",
      forced: true,
      code: { added: 6, removed: 1, files: 4, test_added: 3 },
      plan: { parts: 2, difficulty: ["easy", "hard"], estimated_lines: 120 },
      rounds: [
        { number: 1, checks_passed: false },
        { number: 2, checks_passed: true },
      ],
    });
    expect(Date.parse(written.timeline.closed)).toBeGreaterThanOrEqual(
      Date.parse(written.timeline.opened),
    );
    expect(written.minutes.total).toBeGreaterThanOrEqual(0);
    expect(written.tenbox).toMatch(/^[0-9a-f]{40}$/);
  });

  test("a task with no plan or rounds still gets stats with null fields", async () => {
    await setup();
    const run = await closeT1();
    const text = await readStatsText();
    const written = JSON.parse(text);
    expect(run.json).toMatchObject({ ok: true, stats: { state: "written" } });
    expect(written).toMatchObject({ plan: null, rounds: [], timeline: { plan_start: null } });
  });

  test("a stats write failure does not stop the close", async () => {
    await setup();
    await files.mkdir(path.join(taskWorktree, ".tenbox", "stats.json", "keep"));
    const run = await closeT1();
    const worktreeExists = await files.exists(taskWorktree);
    expect(run.json).toMatchObject({ ok: true });
    expect(String((run.json.stats as { state: string }).state)).toStartWith("failed: ");
    expect(worktreeExists).toBe(false);
    const branches = await branchList();
    expect(branches).toBe("");
  });

  test("a task without .tenbox skips the stats", async () => {
    await setup();
    await rm(path.join(taskWorktree, ".tenbox"), { recursive: true });
    const run = await closeT1();
    const archiveExists = await files.exists(archive);
    expect(run.json).toMatchObject({ stats: { state: "skipped" } });
    expect(archiveExists).toBe(false);
  });
});

interface RunFixture {
  name: string;
  workflow: string;
  startMs: number;
  minutes: number;
  /** Replaces the default result of the run. */
  result?: unknown;
}

/** One workflow run with one worker agent in the task worktree's Claude Code session files. */
async function writeRun(fixture: RunFixture): Promise<void> {
  const sessionDir = path.join(projectDir(env().claudeDir, taskWorktree), "session-1");
  const result = fixture.result ?? {
    status: "ready-for-you",
    nice_to_have: ["a", "b", "c"],
    attention: [MARKER, "b"],
  };
  const agent = {
    type: "workflow_agent",
    label: "round 1: 01",
    phaseTitle: "Build",
    agentId: `agent-of-${fixture.name}`,
    agentType: "worker",
    model: "claude-sonnet-5-5",
    startedAt: fixture.startMs,
    durationMs: fixture.minutes * MS_PER_MINUTE,
    tokens: 1000,
    toolCalls: 3,
    promptPreview: MARKER,
  };
  const run = {
    workflowName: fixture.workflow,
    startTime: fixture.startMs,
    durationMs: fixture.minutes * MS_PER_MINUTE,
    script: MARKER,
    result,
    workflowProgress: [agent],
  };
  await files.write(
    path.join(sessionDir, "workflows", `${fixture.name}.json`),
    JSON.stringify(run),
  );
}

describe("tenbox close stats from Claude Code session files", () => {
  test("counts the plan and build runs after opened, without prompt, result or output text", async () => {
    await setup();
    const start = Date.now();
    await writeRun({
      name: "wf_old",
      workflow: "tenbox-build",
      startMs: start - DAY_MS,
      minutes: 9,
    });
    await writeRun({ name: "wf_plan", workflow: "tenbox-plan", startMs: start, minutes: 1 });
    const buildStart = start + 2 * MS_PER_MINUTE;
    await writeRun({ name: "wf_build", workflow: "tenbox-build", startMs: buildStart, minutes: 3 });
    const run = await closeT1();
    const text = await readStatsText();
    const written = JSON.parse(text);
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(run.json).toMatchObject({ ok: true, stats: { state: "written" } });
    expect(written.timeline).toMatchObject({
      plan_start: iso(start),
      plan_end: iso(start + MS_PER_MINUTE),
      build_start: iso(buildStart),
      build_end: iso(buildStart + 3 * MS_PER_MINUTE),
    });
    const humanReview = minutesBetween(written.timeline.build_end, written.timeline.closed);
    expect(written.minutes).toMatchObject({
      plan: 1,
      wait_approval: 1,
      build: 3,
      human_review: humanReview,
    });
    expect(written.review).toEqual({ must_fix: 0, nice_to_have: 3, attention: 2 });
    expect(written.agents).toEqual(
      ["tenbox-plan", "tenbox-build"].map((workflow, i) => ({
        workflow,
        label: "round 1: 01",
        phase: "Build",
        role: "worker",
        model: "claude-sonnet-5-5",
        started: iso(i === 0 ? start : buildStart),
        seconds: i === 0 ? 60 : 180,
        tokens: 1000,
        tool_calls: 3,
      })),
    );
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("cost");
  });

  test("without session files the run fields are null", async () => {
    await setup();
    await closeT1();
    const text = await readStatsText();
    const written = JSON.parse(text);
    expect(written).toMatchObject({ review: null, agents: null });
    expect(written.minutes).toMatchObject({ plan: null, build: null, human_review: null });
  });
});

describe("tenbox close proofs and points", () => {
  const writePart = async (name: string, text: string) =>
    files.write(path.join(taskWorktree, ".tenbox", "parts", name), text);
  const proofsOf = async () => JSON.parse(await readStatsText());
  const unprovenRun = (reason: string) => ({
    name: "wf_build",
    workflow: "tenbox-build",
    startMs: Date.now(),
    minutes: 1,
    result: { status: "failed", unproven: [{ part: "01", reason }] },
  });

  const proof = (test: string, part = "01") => ({
    part,
    file: "a.test.ts",
    test,
    failure: "got 1",
  });
  const writeProofs = (proofs: unknown[]) =>
    files.write(path.join(taskWorktree, ".tenbox", "proofs.json"), JSON.stringify(proofs));
  const buildRunWith = (proofs: unknown[]) => ({
    name: "wf_build",
    workflow: "tenbox-build",
    startMs: Date.now(),
    minutes: 1,
    result: { status: "ready-for-you", proofs },
  });

  test("proofs from build runs and proofs.json count, runs first; a part without proofs gives 0", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writePart("02-y.md", "status: done\n");
    await writeProofs([proof("second"), proof("third")]);
    await writeRun(buildRunWith([proof("first")]));
    await closeT1();
    const written = await proofsOf();
    expect(written.proofs).toEqual([proof("first"), proof("second"), proof("third")]);
    expect(written.points).toEqual([
      { part: "01", points: 3 },
      { part: "02", points: 0 },
    ]);
  });

  test("the same part, test file and test name in both sources counts once", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeProofs([proof("same"), proof("same"), proof("other")]);
    await writeRun(buildRunWith([{ ...proof("same"), failure: "from the run" }]));
    await closeT1();
    const written = await proofsOf();
    expect(written.proofs).toEqual([{ ...proof("same"), failure: "from the run" }, proof("other")]);
    expect(written.points).toEqual([{ part: "01", points: 2 }]);
  });

  test("padded fields from a run and proofs.json are one proof and 1 point", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeProofs([proof("t")]);
    await writeRun(buildRunWith([{ ...proof(" t "), file: " a.test.ts", failure: "got 1 " }]));
    await closeT1();
    const written = await proofsOf();
    expect(written.proofs).toEqual([proof("t")]);
    expect(written.points).toEqual([{ part: "01", points: 1 }]);
  });

  test.each([
    ["a value that is not an array", '{"part":"01"}'],
    ["an item with a blank field", JSON.stringify([{ ...proof("t"), test: "" }])],
    ["an item that is not an object", JSON.stringify([proof("t"), 7])],
  ])("proofs.json with %s is bad-proofs and closes nothing", async (_name, text) => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await files.write(path.join(taskWorktree, ".tenbox", "proofs.json"), text);
    const run = await closeT1();
    expect(run.json.code).toBe("bad-proofs");
    expect(run.json.error).toContain("proofs.json");
    await expectUntouched(run);
  });

  test("an invalid proofs.json is bad-proofs and closes nothing", async () => {
    await setup();
    await files.write(path.join(taskWorktree, ".tenbox", "proofs.json"), "{ not json");
    const run = await closeT1();
    expect(run.json.code).toBe("bad-proofs");
    await expectUntouched(run);
  });

  test("a Markdown proofs block gives no proof", async () => {
    await setup();
    await writePart("01-x.md", "proofs:\n- a.test.ts > first: got 1\n");
    await closeT1();
    const written = await proofsOf();
    expect(written.proofs).toEqual([]);
    expect(written.points).toEqual([{ part: "01", points: 0 }]);
  });

  test("an unproven item of a build run gives -1 and its reason is not written", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeRun(unprovenRun(MARKER));
    await closeT1();
    const text = await readStatsText();
    expect(JSON.parse(text).points).toEqual([{ part: "01", points: -1 }]);
    expect(text).not.toContain(MARKER);
  });

  test("one proof and one unproven item for the same part give 0", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeProofs([proof("first")]);
    await writeRun(unprovenRun("r"));
    await closeT1();
    const written = await proofsOf();
    expect(written.points).toEqual([{ part: "01", points: 0 }]);
  });
});
