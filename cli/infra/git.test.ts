import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { files } from "./files.ts";
import { git } from "./git.ts";

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
