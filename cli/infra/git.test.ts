import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { files } from "./files.ts";
import { git } from "./git.ts";
import { spawn } from "./spawn.ts";

let project: TempProject;

beforeEach(async () => {
  project = await makeTempProject({ "a.txt": "a\n" });
});

afterEach(async () => {
  await project.remove();
});

test("a broken .git/config throws a git error instead of returning null", async () => {
  await files.write(path.join(project.mainDir, ".git", "config"), "[broken");
  await expect(git.findTopLevel(project.mainDir)).rejects.toMatchObject({ code: "git" });
  await expect(git.findHead(project.mainDir)).rejects.toMatchObject({ code: "git" });
});

test("outside a repository the finders answer null", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "tenbox-outside-"));
  try {
    const top = await git.findTopLevel(outside);
    expect(top).toBeNull();
    const commonDir = await git.findCommonDir(outside);
    expect(commonDir).toBeNull();
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("a detached HEAD has no branch, an attached one has", async () => {
  const attached = await git.findBranch(project.mainDir);
  expect(attached).toBe("main");
  await git.run(["checkout", "-q", "--detach"], project.mainDir);
  const detached = await git.findBranch(project.mainDir);
  expect(detached).toBeNull();
});

test("a missing ref and unrelated histories are null", async () => {
  const exists = await git.refExists(project.mainDir, "nope");
  expect(exists).toBe(false);
  await git.run(["checkout", "-q", "--orphan", "other"], project.mainDir);
  const head = await git.findHead(project.mainDir);
  expect(head).toBeNull();
  await git.run(["commit", "-q", "--allow-empty", "-m", "unrelated"], project.mainDir);
  const mergeBase = await git.findMergeBase(project.mainDir, "main");
  expect(mergeBase).toBeNull();
});

test("findConfig answers null for an unset key", async () => {
  const unset = await git.findConfig(project.mainDir, "tenbox.unset");
  await git.run(["config", "user.email", "me@example.com"], project.mainDir);
  const set = await git.findConfig(project.mainDir, "user.email");
  expect(set).toBe("me@example.com");
  expect(unset).toBeNull();
});

test("findBranchCreated is the branch creation time, not the commit time", async () => {
  const old = "2020-01-01T00:00:00Z";
  await files.write(path.join(project.mainDir, "old.txt"), "x\n");
  await git.run(["add", "old.txt"], project.mainDir);
  const env = { GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old };
  await spawn(["git", "commit", "-q", "-m", "old"], { cwd: project.mainDir, env });
  await git.run(["branch", "feat/old"], project.mainDir);
  const created = await git.findBranchCreated(project.mainDir, "feat/old");
  expect(Date.now() - Date.parse(created ?? "")).toBeLessThan(60_000);
});

test("findBranchCreated reads the reflog; listChangedFiles lists the branch changes", async () => {
  await git.run(["branch", "feat/x"], project.mainDir);
  const created = await git.findBranchCreated(project.mainDir, "feat/x");
  const missing = await git.findBranchCreated(project.mainDir, "feat/none");
  expect(Date.now() - Date.parse(created ?? "")).toBeLessThan(60_000);
  expect(missing).toBeNull();
  await git.run(["checkout", "-q", "feat/x"], project.mainDir);
  await files.write(path.join(project.mainDir, "b.txt"), "1\n2\n");
  await files.write(path.join(project.mainDir, "c.bin"), "\0\0");
  await git.run(["add", "b.txt", "c.bin"], project.mainDir);
  await git.run(["commit", "-q", "-m", "b"], project.mainDir);
  const changed = await git.listChangedFiles(project.mainDir, "main", "feat/x");
  expect(changed).toEqual([
    { added: 2, removed: 0, path: "b.txt" },
    { added: 0, removed: 0, path: "c.bin" },
  ]);
});

test("push puts the branch on origin at HEAD and sets the upstream", async () => {
  const origin = await mkdtemp(path.join(os.tmpdir(), "tenbox-origin-"));
  try {
    await git.run(["init", "-q", "--bare", origin], project.mainDir);
    await git.run(["remote", "add", "origin", origin], project.mainDir);
    await git.run(["checkout", "-q", "-b", "feat/x"], project.mainDir);
    await git.push(project.mainDir, "feat/x");
    const head = await git.findHead(project.mainDir);
    const remote = await git.run(["rev-parse", "refs/heads/feat/x"], origin);
    const upstream = await git.run(["rev-parse", "--abbrev-ref", "@{upstream}"], project.mainDir);
    expect(remote).toBe(head ?? "");
    expect(upstream).toBe("origin/feat/x");
  } finally {
    await rm(origin, { recursive: true, force: true });
  }
});
