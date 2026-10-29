import { afterEach, describe, expect, test } from "bun:test";
import { chmod, rm, utimes } from "node:fs/promises";
import path from "node:path";
import { taskId } from "../../domain/ids.ts";
import { taskDir } from "../../domain/taskDirs.ts";
import { manifests } from "../application/manifests.ts";
import { projectDir } from "../infra/claude/sessionFiles.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { checkResult } from "../test/checkResult.ts";
import { type CliRun, makeFakeClaude, tenbox } from "../test/cli.ts";
import { type FakeTool, fakeTool } from "../test/fakeTools.ts";
import { readStatus } from "../test/taskStatus.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const MS_PER_MINUTE = 60_000;
const DAY_MS = 86_400_000;
const EXECUTABLE = 0o755;
const MARKER = "SECRET-MARKER";
const PLAN_RESULT = JSON.stringify({
  summary: "s",
  estimated_lines: 120,
  parts: [
    { id: "01", difficulty: "easy" },
    { id: "02", difficulty: "hard" },
  ],
  examples: [],
  decisions: [],
  lenses: [],
  questions: [],
});

let project: TempProject;
let taskWorktree: string;
let kept: string;

async function setup(): Promise<void> {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  taskWorktree = path.join(project.wtRoot, "demo", "T-1");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
  const id = await manifests.ensureId(project.mainDir);
  kept = taskDir(project.tenboxHome, id, taskId("T-1"));
}

const closeT1 = (...flags: string[]) => tenbox(["close", "T-1", ...flags], project.mainDir);
const branchList = () => git.run(["branch", "--list", "feat/T-1"], project.mainDir);
const commitOn = async (dir: string, name: string) => {
  await files.write(path.join(dir, name), "x\n");
  await git.run(["add", name], dir);
  await git.run(["commit", "-q", "-m", name], dir);
};

/** The task dir's `stats.json` text; `"null"` when it is missing. */
async function readStatsText(): Promise<string> {
  const text = await files.read(path.join(kept, "stats.json"));
  return text ?? "null";
}

async function expectUntouched(run: CliRun): Promise<void> {
  expect([run.code, run.json.ok]).toEqual([1, false]);
  const worktreeIsDir = await files.isDir(taskWorktree);
  const taskFileExists = await files.exists(path.join(taskWorktree, ".tenbox", "task.md"));
  const branches = await branchList();
  expect(worktreeIsDir).toBe(true);
  expect(taskFileExists).toBe(true);
  expect(branches).not.toBe("");
}

afterEach(async () => {
  await project.remove();
});

describe("tenbox close", () => {
  test("closes a clean task and removes worktree and branch, the task dir stays", async () => {
    await setup();
    const run = await closeT1();
    expect([run.code, run.json.ok]).toEqual([0, true]);
    const keptNames = await files.list(kept);
    const worktreeExists = await files.exists(taskWorktree);
    const worktreeList = await git.run(["worktree", "list"], project.mainDir);
    const branches = await branchList();
    expect(keptNames).toEqual(expect.arrayContaining(["task.md", "parts", "rounds", "stats.json"]));
    expect(run.json).toMatchObject({
      stats: { path: path.join(kept, "stats.json"), state: "written" },
    });
    expect(worktreeExists).toBe(false);
    expect(worktreeList).not.toContain("T-1");
    expect(branches).toBe("");
  });

  test("close sets the status closed and keeps task.json; a refused close leaves it", async () => {
    await setup();
    const taskJson = path.join(kept, "task.json");
    const status = () => readStatus(taskJson);
    await files.write(path.join(taskWorktree, "dirty.txt"), "x\n");
    await closeT1();
    const refused = await status();
    await closeT1("--force");
    const closed = await status();
    expect([refused, closed]).toEqual(["started", "closed"]);
  });

  test("a worktree folder deleted by hand still closes and the branch is deleted", async () => {
    await setup();
    await rm(taskWorktree, { recursive: true, force: true });
    const run = await closeT1();
    const worktreeList = await git.run(["worktree", "list"], project.mainDir);
    const branches = await branchList();
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(run.json).toMatchObject({
      worktree: { state: "skipped" },
      branch: { state: "deleted" },
    });
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

  describe("asks GitHub through gh", () => {
    const FALLBACK_LINE = "tenbox close: gh pr view failed, using the test merge";

    /** A PATH dir with only git in it. */
    async function binWithGit(name: string): Promise<string> {
      const bin = path.join(project.root, name);
      await files.mkdir(bin);
      await files.symlink(Bun.which("git") ?? "git", path.join(bin, "git"));
      return bin;
    }

    /** A PATH with git and a `gh` that runs `body`; the stub records each call in `gh.calls`. */
    async function ghPath(body: string, name = "bin"): Promise<string> {
      const bin = await binWithGit(name);
      const script = `#!/bin/sh\necho "$@" >> "${bin}/gh.calls"\n${body}\n`;
      await files.write(path.join(bin, "gh"), script);
      await chmod(path.join(bin, "gh"), EXECUTABLE);
      return bin;
    }

    const CREATED = "2026-01-01T00:00:00Z";

    const answer = (state: string, sha: string) =>
      `echo '{"state":"${state}","headRefOid":"${sha}","createdAt":"${CREATED}"}'`;

    /** Squash-merges the branch, then changes the same line on main, so the test merge fails. */
    async function squashThenConflict(): Promise<string> {
      await files.write(path.join(taskWorktree, "a.txt"), "branch\n");
      await git.run(["commit", "-q", "-am", "branch"], taskWorktree);
      const head = await git.run(["rev-parse", "HEAD"], taskWorktree);
      await git.run(["merge", "--squash", "feat/T-1"], project.mainDir);
      await git.run(["commit", "-q", "-m", "squash"], project.mainDir);
      await files.write(path.join(project.mainDir, "a.txt"), "later\n");
      await git.run(["commit", "-q", "-am", "later"], project.mainDir);
      return head.trim();
    }

    test("a MERGED PR with the branch head closes although main changed the same lines", async () => {
      await setup();
      const head = await squashThenConflict();
      const bin = await ghPath(answer("MERGED", head));
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      const worktreeExists = await files.exists(taskWorktree);
      const branches = await branchList();
      expect([run.code, run.json.ok]).toEqual([0, true]);
      expect(run.err).not.toContain(FALLBACK_LINE);
      expect(worktreeExists).toBe(false);
      expect(branches).toBe("");
    });

    test("a gh pr view whose createdAt is not an ISO date-time fails and changes nothing", async () => {
      await setup();
      const head = await squashThenConflict();
      const json = `{"state":"MERGED","headRefOid":"${head}","createdAt":"yesterday"}`;
      const bin = await ghPath(`echo '${json}'`);
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      await expectUntouched(run);
    });

    test("a commit after the PR head is refused", async () => {
      await setup();
      const head = await squashThenConflict();
      await commitOn(taskWorktree, "later.txt");
      const bin = await ghPath(answer("MERGED", head));
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      await expectUntouched(run);
      expect(run.json).toMatchObject({ code: "unmerged" });
    });

    test("an OPEN or CLOSED PR is refused, even when the test merge would pass", async () => {
      await setup();
      await commitOn(taskWorktree, "b.txt");
      await git.run(["merge", "--squash", "feat/T-1"], project.mainDir);
      await git.run(["commit", "-q", "-m", "squash"], project.mainDir);
      const rawHead = await git.run(["rev-parse", "feat/T-1"], project.mainDir);
      const head = rawHead.trim();
      for (const state of ["OPEN", "CLOSED"]) {
        const bin = await ghPath(answer(state, head), state);
        const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
        await expectUntouched(run);
        expect(run.json).toMatchObject({ code: "unmerged" });
      }
    });

    test("a gh that fails uses the test merge and says so on stderr", async () => {
      await setup();
      await commitOn(taskWorktree, "b.txt");
      const bin = await ghPath("echo 'no pull requests found' >&2\nexit 1");
      const refused = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      await expectUntouched(refused);
      expect(refused.err).toContain(FALLBACK_LINE);
      await git.run(["merge", "--squash", "feat/T-1"], project.mainDir);
      await git.run(["commit", "-q", "-m", "squash"], project.mainDir);
      const closed = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      expect([closed.code, closed.json.ok]).toEqual([0, true]);
    });

    test("without gh in PATH the test merge decides and stderr says so", async () => {
      await setup();
      await commitOn(taskWorktree, "b.txt");
      const bin = await binWithGit("nogh");
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      await expectUntouched(run);
      expect(run.err).toContain(FALLBACK_LINE);
    });

    test("--force does not call gh", async () => {
      await setup();
      await commitOn(taskWorktree, "b.txt");
      const bin = await ghPath("exit 1");
      const run = await tenbox(["close", "T-1", "--force"], project.mainDir, { PATH: bin });
      const calls = await files.exists(path.join(bin, "gh.calls"));
      expect([run.code, run.json.ok]).toEqual([0, true]);
      expect(calls).toBe(false);
    });

    test("a MERGED PR gives review and wait_merge minutes, schema 7, no human_review", async () => {
      await setup();
      await commitOn(taskWorktree, "b.txt");
      const rawHead = await git.run(["rev-parse", "HEAD"], taskWorktree);
      const buildStart = Date.now();
      await writeRun({
        name: "wf_build",
        workflow: "tenbox-build",
        startMs: buildStart,
        minutes: 3,
      });
      const buildEnd = buildStart + 3 * MS_PER_MINUTE;
      const created = new Date(buildEnd + 10 * MS_PER_MINUTE).toISOString();
      const merged = new Date(buildEnd + 30 * MS_PER_MINUTE).toISOString();
      const json = `{"state":"MERGED","headRefOid":"${rawHead.trim()}","createdAt":"${created}","mergedAt":"${merged}"}`;
      const bin = await ghPath(`case "$1" in\n  pr) echo '${json}';;\n  api) echo 1;;\nesac`);
      await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      const text = await readStatsText();
      const written = JSON.parse(text);
      expect(written.schema).toBe(7);
      expect(written.runs).toMatchObject([{ workflow: "tenbox-build", finished: true }]);
      expect(written.minutes).toMatchObject({ review: 10, wait_merge: 20 });
      expect(written.minutes).not.toHaveProperty("human_review");
    });

    test("a PR created before the build run ends gives review 0, not a negative number", async () => {
      await setup();
      await commitOn(taskWorktree, "b.txt");
      const rawHead = await git.run(["rev-parse", "HEAD"], taskWorktree);
      const buildStart = Date.now();
      await writeRun({
        name: "wf_build",
        workflow: "tenbox-build",
        startMs: buildStart,
        minutes: 3,
      });
      const buildEnd = buildStart + 3 * MS_PER_MINUTE;
      const created = new Date(buildEnd - 6_000).toISOString();
      const merged = new Date(buildEnd + 30 * MS_PER_MINUTE).toISOString();
      const json = `{"state":"MERGED","headRefOid":"${rawHead.trim()}","createdAt":"${created}","mergedAt":"${merged}"}`;
      const bin = await ghPath(`case "$1" in\n  pr) echo '${json}';;\n  api) echo 1;;\nesac`);
      await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      const text = await readStatsText();
      expect(JSON.parse(text).minutes.review).toBe(0);
    });

    test("without a PR review and wait_merge are null", async () => {
      await setup();
      const bin = await ghPath("exit 1");
      await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      const text = await readStatsText();
      const written = JSON.parse(text);
      expect(written.minutes).toMatchObject({ review: null, wait_merge: null });
    });

    test("--force writes review and wait_merge as null", async () => {
      await setup();
      await commitOn(taskWorktree, "b.txt");
      const bin = await ghPath("exit 1");
      await tenbox(["close", "T-1", "--force"], project.mainDir, { PATH: bin });
      const text = await readStatsText();
      const written = JSON.parse(text);
      expect(written.minutes).toMatchObject({ review: null, wait_merge: null });
    });

    /** A `gh` that says MERGED at `head`; `parents` is what the commit lookup prints. */
    const mergedGh = (head: string, parents: number) =>
      `case "$1" in\n  pr) echo '{"state":"MERGED","headRefOid":"${head}","mergeCommit":{"oid":"m1"},"createdAt":"${CREATED}"}';;\n  api) echo ${parents};;\nesac`;

    /** A bare `origin` with `main` and the task branch pushed. */
    async function addOrigin(): Promise<string> {
      const origin = path.join(project.root, "origin.git");
      await git.run(["init", "-q", "--bare", "-b", "main", origin], project.root);
      await git.run(["remote", "add", "origin", origin], project.mainDir);
      await git.run(["push", "-q", "origin", "main"], project.mainDir);
      await git.run(["push", "-q", "origin", "feat/T-1"], project.mainDir);
      return origin;
    }

    /** Pushes a new commit to `origin/main` from a second clone. */
    async function advanceOrigin(origin: string): Promise<void> {
      const other = path.join(project.root, "other");
      await git.run(["clone", "-q", origin, other], project.root);
      await git.run(["config", "user.name", "t"], other);
      await git.run(["config", "user.email", "t@example.com"], other);
      await commitOn(other, "upstream.txt");
      await git.run(["push", "-q", "origin", "main"], other);
    }

    /** The task branch has one commit; returns its sha and a PATH whose gh says MERGED there. */
    async function mergedOnGithub(parents = 1): Promise<{ origin: string; bin: string }> {
      await commitOn(taskWorktree, "b.txt");
      const head = await git.run(["rev-parse", "HEAD"], taskWorktree);
      const origin = await addOrigin();
      const bin = await ghPath(mergedGh(head.trim(), parents));
      return { origin, bin };
    }

    const remoteHeads = (origin: string) => git.run(["branch", "--list"], origin);

    /** Pushes a new commit to `origin/feat/T-1` from a second clone; returns its sha. */
    async function pushFromOtherClone(origin: string): Promise<string> {
      const other = path.join(project.root, "other-branch");
      await git.run(["clone", "-q", "-b", "feat/T-1", origin, other], project.root);
      await git.run(["config", "user.name", "t"], other);
      await git.run(["config", "user.email", "t@example.com"], other);
      await commitOn(other, "remote.txt");
      await git.run(["push", "-q", "origin", "feat/T-1"], other);
      const head = await git.run(["rev-parse", "HEAD"], other);
      return head.trim();
    }

    test("close fast-forwards a task branch pushed from another clone", async () => {
      await setup();
      const origin = await addOrigin();
      const head = await pushFromOtherClone(origin);
      const bin = await ghPath(mergedGh(head, 1));
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      const worktreeIsDir = await files.isDir(taskWorktree);
      const branches = await branchList();
      expect([run.code, run.json.ok]).toEqual([0, true]);
      expect(worktreeIsDir).toBe(false);
      expect(branches).toBe("");
    });

    test("close keeps a branch that is ahead of origin", async () => {
      await setup();
      const origin = await addOrigin();
      const originHead = await git.run(["rev-parse", "feat/T-1"], origin);
      await commitOn(taskWorktree, "local.txt");
      const localHead = await git.run(["rev-parse", "feat/T-1"], project.mainDir);
      const bin = await ghPath(mergedGh(originHead.trim(), 1));
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      await expectUntouched(run);
      const after = await git.run(["rev-parse", "feat/T-1"], project.mainDir);
      expect(run.json).toMatchObject({ code: "unmerged" });
      expect(after).toBe(localHead);
    });

    test("close goes on when the remote branch is gone", async () => {
      await setup();
      const origin = path.join(project.root, "origin.git");
      await git.run(["init", "-q", "--bare", "-b", "main", origin], project.root);
      await git.run(["remote", "add", "origin", origin], project.mainDir);
      await git.run(["push", "-q", "origin", "main"], project.mainDir);
      const bin = await binWithGit("nogh-remote");
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      expect([run.code, run.json.ok]).toEqual([0, true]);
    });

    test("a merge commit is refused and nothing changes", async () => {
      await setup();
      const { origin, bin } = await mergedOnGithub(2);
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      await expectUntouched(run);
      const heads = await remoteHeads(origin);
      expect(run.json).toMatchObject({ code: "merge-commit" });
      expect(heads).toContain("feat/T-1");
    });

    test("a merge commit whose head is in origin/main closes like a squash merge", async () => {
      await setup();
      const { origin, bin } = await mergedOnGithub(2);
      await git.run(["merge", "--no-ff", "-q", "-m", "merge", "feat/T-1"], project.mainDir);
      await git.run(["push", "-q", "origin", "main"], project.mainDir);
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      const heads = await remoteHeads(origin);
      expect(run.json).toMatchObject({ ok: true, remote_branch: { state: "deleted" } });
      const worktreeIsDir = await files.isDir(taskWorktree);
      expect(worktreeIsDir).toBe(false);
      expect(heads).not.toContain("feat/T-1");
    });

    test("a merge commit whose head is not in origin/main is refused with the reason", async () => {
      await setup();
      const { bin } = await mergedOnGithub(2);
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      await expectUntouched(run);
      expect(run.json).toMatchObject({ code: "merge-commit" });
      expect(String(run.json.error)).toContain("not in origin/main");
    });

    test("a parent count that is not a number is the error gh and nothing changes", async () => {
      await setup();
      await commitOn(taskWorktree, "b.txt");
      const head = await git.run(["rev-parse", "HEAD"], taskWorktree);
      const bin = await ghPath(mergedGh(head.trim(), 1).replace("echo 1", "echo nope"));
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      await expectUntouched(run);
      expect(run.json).toMatchObject({ code: "gh" });
    });

    test("a close from inside the task worktree is refused, also with --force", async () => {
      await setup();
      for (const flags of [[], ["--force"]]) {
        const run = await tenbox(["close", "T-1", ...flags], taskWorktree);
        await expectUntouched(run);
        expect(run.json).toMatchObject({ code: "in-task-worktree" });
      }
    });

    test("a MERGED PR pulls the base and deletes the remote branch", async () => {
      await setup();
      const { origin, bin } = await mergedOnGithub();
      await advanceOrigin(origin);
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      const mainHead = await git.run(["rev-parse", "HEAD"], project.mainDir);
      const originMain = await git.run(["rev-parse", "main"], origin);
      const heads = await remoteHeads(origin);
      expect(run.json).toMatchObject({
        ok: true,
        pull: { base: "main", state: "pulled" },
        remote_branch: { name: "feat/T-1", state: "deleted" },
      });
      expect(mainHead).toBe(originMain);
      expect(heads).not.toContain("feat/T-1");
    });

    test("a remote branch that is already gone is skipped", async () => {
      await setup();
      const { origin, bin } = await mergedOnGithub();
      await git.run(["branch", "-D", "feat/T-1"], origin);
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      expect([run.code, run.json.ok]).toEqual([0, true]);
      expect(run.json).toMatchObject({ remote_branch: { state: "skipped" } });
    });

    test("a main checkout on another branch is not pulled", async () => {
      await setup();
      const { origin, bin } = await mergedOnGithub();
      await advanceOrigin(origin);
      await git.run(["checkout", "-q", "-b", "other"], project.mainDir);
      const before = await git.run(["rev-parse", "HEAD"], project.mainDir);
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      const after = await git.run(["rev-parse", "HEAD"], project.mainDir);
      expect(run.json).toMatchObject({ pull: { state: "skipped" } });
      expect(after).toBe(before);
    });

    test("a pull that cannot fast-forward fails but the close goes on", async () => {
      await setup();
      const { origin, bin } = await mergedOnGithub();
      await advanceOrigin(origin);
      await commitOn(project.mainDir, "local.txt");
      const run = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
      const worktreeExists = await files.exists(taskWorktree);
      const branches = await branchList();
      expect([run.code, run.json.ok]).toEqual([0, true]);
      expect(run.json).toMatchObject({ pull: { state: expect.stringMatching(/^failed: /) } });
      expect(worktreeExists).toBe(false);
      expect(branches).toBe("");
    });

    test("--force neither pulls nor deletes the remote branch", async () => {
      await setup();
      const { origin } = await mergedOnGithub();
      const forced = await closeT1("--force");
      const heads = await remoteHeads(origin);
      expect(forced.json).toMatchObject({
        pull: { state: "skipped" },
        remote_branch: { state: "skipped" },
      });
      expect(heads).toContain("feat/T-1");
    });
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

  test("a second close skips every step and keeps the first stats.json", async () => {
    await setup();
    await closeT1();
    const first = await readStatsText();
    const run = await closeT1();
    const second = await readStatsText();
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(second).toBe(first);
    expect(run.json).toMatchObject({
      stats: { path: null, state: "skipped" },
      session: { state: "skipped" },
      worktree: { state: "skipped" },
      branch: { state: "skipped" },
      tracker: { status: "skipped" },
    });
  });

  test("stops the task's background sessions; with none it is skipped", async () => {
    await setup();
    const fake = await makeFakeClaude(project.root);
    const real = await files.realPath(taskWorktree);
    await fake.setSessions([
      { id: "plan", cwd: real, kind: "background", startedAt: 1, pid: 11 },
      { id: "build", cwd: real, kind: "background", startedAt: 2, pid: 12 },
      { id: "shell", cwd: real, kind: "interactive", startedAt: 3, pid: 13 },
    ]);
    const run = await tenbox(["close", "T-1"], project.mainDir, fake.env);
    const calls = await fake.calls();
    expect(run.json).toMatchObject({ ok: true, session: { state: "stopped" } });
    expect(Object.keys(run.json).sort()).toEqual([
      "branch",
      "comment",
      "forced",
      "ok",
      "project",
      "pull",
      "remote_branch",
      "session",
      "stats",
      "task",
      "tracker",
      "worktree",
    ]);
    expect(calls.map((call) => call.args).slice(1)).toEqual([
      ["stop", "plan"],
      ["stop", "build"],
    ]);
    await fake.setSessions([]);
    await rm(kept, { recursive: true });
    await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
    const again = await tenbox(["close", "T-1"], project.mainDir, fake.env);
    expect(again.json).toMatchObject({ ok: true, session: { state: "skipped" } });
  });

  test("a session listed without a pid has no process any more and is not stopped", async () => {
    await setup();
    const fake = await makeFakeClaude(project.root);
    const real = await files.realPath(taskWorktree);
    await fake.setSessions([
      { id: "old-boot", cwd: real, kind: "background", startedAt: 1, state: "blocked" },
    ]);
    const run = await tenbox(["close", "T-1"], project.mainDir, fake.env);
    const calls = await fake.calls();
    expect(run.json).toMatchObject({ ok: true, session: { state: "skipped" } });
    expect(calls.map((call) => call.args[0])).toEqual(["agents"]);
  });

  test("without claude in PATH the session step is skipped", async () => {
    await setup();
    const bin = path.join(project.root, "bin");
    await files.mkdir(bin);
    await files.symlink(Bun.which("git") ?? "git", path.join(bin, "git"));
    const noClaude = await tenbox(["close", "T-1"], project.mainDir, { PATH: bin });
    expect(noClaude.json).toMatchObject({ ok: true, session: { state: "skipped" } });
  });

  test("a claude that fails gives session failed: <reason> and the close goes on", async () => {
    await setup();
    const fake = await makeFakeClaude(project.root);
    await fake.failWith("Workspace not trusted");
    const run = await tenbox(["close", "T-1"], project.mainDir, fake.env);
    const worktreeExists = await files.exists(taskWorktree);
    expect(run.json).toMatchObject({
      ok: true,
      session: { state: "failed: claude agents failed: Workspace not trusted" },
      worktree: { state: "removed" },
    });
    expect(worktreeExists).toBe(false);
  });

  test("with tracker none the tracker status is skipped", async () => {
    await setup();
    const run = await closeT1();
    expect(run.json).toMatchObject({ tracker: { kind: "none", status: "skipped" } });
  });

  test("with tracker none the close comment is skipped", async () => {
    await setup();
    const run = await closeT1();
    expect(run.json).toMatchObject({ ok: true, comment: { state: "skipped" } });
  });

  test("a tracker that fails the comment gives failed: <reason> and the close is ok", async () => {
    project = await makeTempProject({
      "tenbox.yaml": "project: demo\ntracker: { kind: clickup, api_key: bad }\n",
      "a.txt": "a\n",
    });
    taskWorktree = path.join(project.wtRoot, "demo", "T-1");
    await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
    const run = await closeT1();
    expect(run.json).toMatchObject({
      ok: true,
      comment: { state: expect.stringMatching(/^failed: /) },
    });
  });

  test("writes stats.json with git and task file numbers", async () => {
    await setup();
    const dir = path.join(taskWorktree, ".tenbox");
    await files.write(path.join(dir, "plan.md"), "# plan\n");
    await files.write(path.join(dir, "parts", "01-a.md"), "status: todo\n");
    await files.write(path.join(dir, "parts", "02-b.md"), "status: todo\n");
    const done = await tenbox(["plan", "done", "T-1", "--json", PLAN_RESULT], project.mainDir);
    expect(done.json.ok).toBe(true);
    await files.writeJson(path.join(dir, "rounds", "1", "checks.json"), checkResult({ ok: false }));
    await files.writeJson(path.join(dir, "rounds", "2", "checks.json"), checkResult({ round: 2 }));
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
      stats: { path: path.join(kept, "stats.json"), state: "written" },
    });
    expect(written).toMatchObject({
      schema: 7,
      project: "demo",
      task: "T-1",
      title: "x",
      user: "me@example.com",
      forced: true,
      findings: [],
      code: { added: 6, removed: 1, files: 4, test_added: 3 },
      plan: { parts: 2, difficulty: ["easy", "hard"], estimated_lines: 120 },
      runs: null,
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

  test("code leaves out files marked linguist-generated", async () => {
    await setup();
    await files.write(path.join(taskWorktree, ".gitattributes"), "bun.lock linguist-generated\n");
    await files.write(path.join(taskWorktree, "bun.lock"), "1\n2\n3\n");
    await files.write(path.join(taskWorktree, "src", "a.ts"), "1\n");
    await git.run(["add", "."], taskWorktree);
    await git.run(["commit", "-q", "-m", "code"], taskWorktree);
    await closeT1("--force");
    const text = await readStatsText();
    expect(JSON.parse(text).code).toEqual({ added: 2, removed: 0, files: 2, test_added: 0 });
  });

  test("a plan.md and part files without plan.json give plan null", async () => {
    await setup();
    const dir = path.join(taskWorktree, ".tenbox");
    await files.write(path.join(dir, "plan.md"), "Estimated lines: 120\n");
    await files.write(path.join(dir, "parts", "01-a.md"), "difficulty: easy\n");
    await closeT1();
    const text = await readStatsText();
    expect(JSON.parse(text).plan).toBeNull();
  });

  test("the title in stats.json comes from task.json, not task.md", async () => {
    await setup();
    const dir = path.join(taskWorktree, ".tenbox");
    const taskText = await files.read(path.join(dir, "task.json"));
    const taskJson = JSON.parse(taskText ?? "null");
    await files.write(path.join(dir, "task.json"), JSON.stringify({ ...taskJson, title: "y" }));
    await closeT1();
    const text = await readStatsText();
    expect(JSON.parse(text).title).toBe("y");
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
    expect(run.json.stats).toMatchObject({ state: expect.stringMatching(/^failed: /) });
    expect(worktreeExists).toBe(false);
    const branches = await branchList();
    expect(branches).toBe("");
  });

  test("a task without a task dir gets no stats and still closes", async () => {
    await setup();
    await rm(kept, { recursive: true });
    const run = await closeT1();
    const worktreeExists = await files.exists(taskWorktree);
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(run.json).toMatchObject({ stats: { path: null, state: "skipped" } });
    expect(worktreeExists).toBe(false);
  });

  test("a project without an id keeps its tenbox.yaml and gets no stats", async () => {
    await setup();
    const manifestFile = path.join(project.mainDir, "tenbox.yaml");
    await files.write(manifestFile, "project: demo\n");
    const run = await closeT1();
    const manifestText = await files.read(manifestFile);
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(run.json).toMatchObject({ stats: { path: null, state: "skipped" } });
    expect(manifestText).toBe("project: demo\n");
  });
});

describe("tenbox close a task with groups", () => {
  const RECIPE = { model: "sonnet", effort: "medium", lenses: [], tier: "fast" };
  const GROUP_PLAN = {
    summary: "s",
    estimated_lines: 10,
    parts: [
      { id: "01", difficulty: "easy" },
      { id: "02", difficulty: "easy" },
    ],
    examples: [],
    decisions: [],
    lenses: [],
    questions: [],
    groups: [
      { id: 1, name: "feat: first", parts: ["01"], needs: [], recipe: RECIPE },
      { id: 2, name: "feat: second", parts: ["02"], needs: [1], recipe: RECIPE },
    ],
  };
  const ODD_BRANCH = "odd-name";
  /** A fake `gh` that answers from the PRs in `prs`. */
  const groupGh =
    (prs: string): FakeTool =>
    async (args) => {
      const text = await files.read(prs);
      const list: { headRefName: string; state: string; head: string }[] = JSON.parse(text ?? "[]");
      const [group, action, branch] = args;
      if (group === "api") return { stdout: "1\n" };
      if (group !== "pr") return {};
      if (action === "list") return { stdout: `${JSON.stringify(list)}\n` };
      const pr = list.find((p) => p.headRefName === branch);
      if (action !== "view" || pr === undefined) return {};
      const view = {
        state: pr.state,
        headRefOid: pr.head,
        mergeCommit: { oid: "m" },
        createdAt: "2026-01-01T00:00:00Z",
      };
      return { stdout: `${JSON.stringify(view)}\n` };
    };

  interface GroupTask {
    groupWorktree: string;
    origin: string;
    prs: string;
    env: Record<string, string>;
  }

  /** Group 1 on feat/T-1 and group 2 on a branch whose name does not fit `names.branch`; both pushed. */
  async function makeGroupTask(state2: string): Promise<GroupTask> {
    await setup();
    await files.write(path.join(taskWorktree, ".tenbox", "plan.json"), JSON.stringify(GROUP_PLAN));
    const made = await tenbox(["worktree", "T-1", "--group", "2"], project.mainDir);
    const groupWorktree = String(made.json.worktree);
    await commitOn(taskWorktree, "one.txt");
    await commitOn(groupWorktree, "two.txt");
    await git.run(["branch", "-m", "feat/T-1-2", ODD_BRANCH], groupWorktree);
    const origin = path.join(project.root, "origin.git");
    await git.run(["init", "-q", "--bare", "-b", "main", origin], project.root);
    await git.run(["remote", "add", "origin", origin], project.mainDir);
    await git.run(["push", "-q", "origin", "main", "feat/T-1", ODD_BRANCH], project.mainDir);
    const out1 = await git.run(["rev-parse", "HEAD"], taskWorktree);
    const out2 = await git.run(["rev-parse", "HEAD"], groupWorktree);
    const [head1, head2] = [out1.trim(), out2.trim()];
    const prs = path.join(project.root, "prs.json");
    const pr = (n: number, state: string, head: string, branch: string) => ({
      number: n,
      url: `https://example.com/pull/${n}`,
      isDraft: false,
      state,
      body: `tenbox: T-1 group ${n}\n\ntext`,
      headRefName: branch,
      head,
    });
    const list = [pr(1, "MERGED", head1, "feat/T-1"), pr(2, state2, head2, ODD_BRANCH)];
    await files.write(prs, JSON.stringify(list));
    fakeTool("gh", groupGh(prs));
    const env = {};
    return { groupWorktree, origin, prs, env };
  }

  test("closes when every group PR is merged and removes every group", async () => {
    const task = await makeGroupTask("MERGED");
    const run = await tenbox(["close", "T-1"], project.mainDir, task.env);
    const worktreeList = await git.run(["worktree", "list"], project.mainDir);
    const localBranches = await git.run(["branch", "--list"], project.mainDir);
    const remoteBranches = await git.run(["branch", "--list"], task.origin);
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(run.json).toMatchObject({
      groups: [
        {
          group: 2,
          worktree: { path: task.groupWorktree, state: "removed" },
          branch: { name: ODD_BRANCH, state: "deleted" },
          remote_branch: { name: ODD_BRANCH, state: "deleted" },
        },
      ],
    });
    expect(worktreeList).not.toContain("T-1");
    expect(localBranches).not.toContain(ODD_BRANCH);
    expect(localBranches).not.toContain("feat/T-1");
    expect(remoteBranches).not.toContain(ODD_BRANCH);
    expect(remoteBranches).not.toContain("feat/T-1");
  });

  test("an open group PR gives unmerged, names the group and changes nothing", async () => {
    const task = await makeGroupTask("OPEN");
    const run = await tenbox(["close", "T-1"], project.mainDir, task.env);
    const groupExists = await files.isDir(task.groupWorktree);
    const taskExists = await files.isDir(taskWorktree);
    const branches = await git.run(["branch", "--list"], project.mainDir);
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "unmerged"]);
    expect(String(run.json.error)).toContain("group 2");
    expect([groupExists, taskExists]).toEqual([true, true]);
    expect(branches).toContain(ODD_BRANCH);
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
  test("counts the plan and build runs after opened, without prompt, result or output text, and ignores their result", async () => {
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
    expect(written.minutes).toMatchObject({
      plan: 1,
      wait_approval: 1,
      build: 3,
      review: null,
      wait_merge: null,
    });
    expect(written.review).toBeNull();
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
        round: i === 0 ? null : 1,
        calls: null,
        input: null,
        output: null,
        cache_write: null,
        cache_read: null,
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
    expect(written.minutes).toMatchObject({
      plan: null,
      build: null,
      review: null,
      wait_merge: null,
    });
  });
});

describe("tenbox close build result, proofs and points", () => {
  const writePart = async (name: string, text: string) =>
    files.write(path.join(taskWorktree, ".tenbox", "parts", name), text);
  const proofsOf = async () => {
    const text = await readStatsText();
    return JSON.parse(text);
  };
  const proof = (test: string, part = "01") => ({
    part,
    file: "a.test.ts",
    test,
    failure: "got 1",
  });
  const writeProofs = (proofs: unknown[]) =>
    files.write(path.join(taskWorktree, ".tenbox", "proofs.json"), JSON.stringify(proofs));
  const writeBuild = (change: Record<string, unknown>) =>
    files.write(
      path.join(taskWorktree, ".tenbox", "build.json"),
      JSON.stringify({
        status: "ready-for-you",
        round: 1,
        proofs: [],
        attention: [],
        nice_to_have: [],
        unproven: [],
        ...change,
      }),
    );
  const sessionRun = (result: unknown) => ({
    name: "wf_build",
    workflow: "tenbox-build",
    startMs: Date.now(),
    minutes: 1,
    result,
  });

  test("review counts come from build.json: must_fix 0 for ready-for-you", async () => {
    await setup();
    await writeBuild({ nice_to_have: ["a", "b", "c"], attention: [MARKER, "b"] });
    await closeT1();
    const text = await readStatsText();
    expect(JSON.parse(text).review).toEqual({ must_fix: 0, nice_to_have: 3, attention: 2 });
    expect(text).not.toContain(MARKER);
  });

  test("a round whose checks.json is newer than build.json is not in rounds", async () => {
    await setup();
    const dir = path.join(taskWorktree, ".tenbox");
    const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000);
    const checks1 = path.join(dir, "rounds", "1", "checks.json");
    const checks2 = path.join(dir, "rounds", "2", "checks.json");
    await files.writeJson(checks1, checkResult({}));
    await files.writeJson(checks2, checkResult({ round: 2 }));
    await writeBuild({});
    await utimes(checks1, at(100), at(100));
    await utimes(path.join(dir, "build.json"), at(50), at(50));
    await utimes(checks2, at(10), at(10));
    await closeT1();
    const written = await proofsOf();
    expect(written.rounds).toEqual([{ number: 1, checks_passed: true }]);
  });

  test("review must_fix is null for a build result that is not ready-for-you", async () => {
    await setup();
    await writeBuild({ status: "failed", nice_to_have: ["a"] });
    await closeT1();
    const written = await proofsOf();
    expect(written.review).toEqual({ must_fix: null, nice_to_have: 1, attention: 0 });
  });

  test("without build.json the review is null", async () => {
    await setup();
    await closeT1();
    const written = await proofsOf();
    expect(written.review).toBeNull();
  });

  test("proofs and unproven items in a session result are ignored", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeRun(
      sessionRun({
        status: "ready-for-you",
        nice_to_have: ["a"],
        attention: ["b"],
        proofs: [proof("from the run")],
        unproven: [{ part: "01", reason: "r" }],
      }),
    );
    await closeT1();
    const written = await proofsOf();
    expect(written.proofs).toEqual([]);
    expect(written.review).toBeNull();
    expect(written.points).toEqual([{ part: "01", points: 0 }]);
  });

  test("proofs of build.json are not read; proofs.json gives the proofs and a part without proofs 0", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writePart("02-y.md", "status: done\n");
    await writeBuild({ proofs: [proof("only in build")] });
    await writeProofs([proof("second"), proof("third")]);
    await closeT1();
    const written = await proofsOf();
    expect(written.proofs).toEqual([proof("second"), proof("third")]);
    expect(written.points).toEqual([
      { part: "01", points: 2 },
      { part: "02", points: 0 },
    ]);
  });

  test("the same part, test file and test name twice counts once", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeProofs([proof("same"), { ...proof("same"), failure: "later" }, proof("other")]);
    await closeT1();
    const written = await proofsOf();
    expect(written.proofs).toEqual([proof("same"), proof("other")]);
    expect(written.points).toEqual([{ part: "01", points: 2 }]);
  });

  test("padded fields are one proof and 1 point", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeProofs([proof("t"), { ...proof(" t "), file: " a.test.ts", failure: "got 1 " }]);
    await closeT1();
    const written = await proofsOf();
    expect(written.proofs).toEqual([proof("t")]);
    expect(written.points).toEqual([{ part: "01", points: 1 }]);
  });

  test.each([
    ["a value that is not an array", '{"part":"01"}'],
    ["an item with a blank field", JSON.stringify([{ ...proof("t"), test: "" }])],
    ["an item that is not an object", JSON.stringify([proof("t"), 7])],
  ])("proofs.json with %s is bad-file and closes nothing", async (_name, text) => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await files.write(path.join(taskWorktree, ".tenbox", "proofs.json"), text);
    const run = await closeT1();
    expect(run.json.code).toBe("bad-file");
    expect(run.json.error).toContain("proofs.json");
    await expectUntouched(run);
  });

  test("an invalid proofs.json is bad-file and closes nothing", async () => {
    await setup();
    await files.write(path.join(taskWorktree, ".tenbox", "proofs.json"), "{ not json");
    const run = await closeT1();
    expect(run.json.code).toBe("bad-file");
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

  test("an unproven item of build.json gives -1 and its reason is not written", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeBuild({ unproven: [{ part: "01", reason: MARKER }] });
    await closeT1();
    const text = await readStatsText();
    expect(JSON.parse(text).points).toEqual([{ part: "01", points: -1 }]);
    expect(text).not.toContain(MARKER);
  });

  test("one proof and one unproven item for the same part give 0", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeProofs([proof("first")]);
    await writeBuild({ unproven: [{ part: "01", reason: "r" }] });
    await closeT1();
    const written = await proofsOf();
    expect(written.points).toEqual([{ part: "01", points: 0 }]);
  });

  test("a proof named by part file slug and one named by number are one row", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeProofs([proof("recorded"), proof("built", "01-x")]);
    await closeT1();
    const written = await proofsOf();
    expect(written.proofs).toEqual([proof("recorded"), proof("built")]);
    expect(written.points).toEqual([{ part: "01", points: 2 }]);
  });

  test("an unproven item named 01-x lowers the 01 row", async () => {
    await setup();
    await writePart("01-x.md", "status: done\n");
    await writeBuild({ unproven: [{ part: "01-x", reason: "r" }] });
    await closeT1();
    const written = await proofsOf();
    expect(written.points).toEqual([{ part: "01", points: -1 }]);
  });
});
