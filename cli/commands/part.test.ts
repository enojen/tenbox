import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;
let worktree: string;

const plan = {
  summary: "s",
  estimated_lines: 1,
  parts: [
    { id: "01", difficulty: "easy", files: ["a.txt"] },
    { id: "02", difficulty: "easy", files: ["b.txt"] },
    { id: "03", difficulty: "easy" },
  ],
  examples: [],
  decisions: [],
  lenses: [],
  questions: [],
};

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  worktree = path.join(project.wtRoot, "demo", "T-1");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
  await files.writeJson(path.join(worktree, ".tenbox", "plan.json"), plan);
});

afterEach(async () => {
  await project.remove();
});

const commit = async (name: string): Promise<string> => {
  await files.write(path.join(worktree, name), `${name} ${Math.random()}\n`);
  await git.run(["add", name], worktree);
  await git.run(["commit", "-q", "-m", name], worktree);
  return git.run(["rev-parse", "HEAD"], worktree);
};

const done = (...flags: string[]) => tenbox(["part", "done", "T-1", ...flags], project.mainDir);

describe("tenbox part done", () => {
  test("a new commit that touches the part's files passes", async () => {
    const sha = await commit("a.txt");
    const run = await done("--part", "01", "--commit", sha.slice(0, 8));
    expect(run.code).toBe(0);
    expect(run.json).toEqual({ ok: true, task: "T-1", part: "01", commit: sha });
  });

  test("a commit that is not after --since is not new", async () => {
    const sha = await commit("a.txt");
    const run = await done("--part", "01", "--commit", sha, "--since", sha);
    expect([run.code, run.json.code]).toEqual([1, "part-not-committed"]);
    expect(run.json.error).toContain("not new");
  });

  test("no --commit and an unknown sha fail", async () => {
    const none = await done("--part", "01");
    const unknown = await done("--part", "01", "--commit", "deadbeef");
    expect([none.code, none.json.code]).toEqual([1, "part-not-committed"]);
    expect([unknown.code, unknown.json.code]).toEqual([1, "part-not-committed"]);
  });

  test("a commit on another branch is not on HEAD", async () => {
    await git.run(["checkout", "-q", "-b", "other"], worktree);
    const sha = await commit("a.txt");
    await git.run(["checkout", "-q", "feat/T-1"], worktree);
    const run = await done("--part", "01", "--commit", sha);
    expect([run.code, run.json.code]).toEqual([1, "part-not-committed"]);
    expect(run.json.error).toContain("not on HEAD");
  });

  test("a commit outside the part's files fails", async () => {
    const sha = await commit("c.txt");
    const run = await done("--part", "02", "--commit", sha);
    expect([run.code, run.json.code]).toEqual([1, "part-not-committed"]);
  });

  test("a staged change in the part's files fails and names the file", async () => {
    await commit("b.txt");
    const sha = await commit("b.txt");
    await files.write(path.join(worktree, "b.txt"), "staged\n");
    await git.run(["add", "b.txt"], worktree);
    const run = await done("--part", "02", "--commit", sha);
    expect([run.code, run.json.code]).toEqual([1, "part-not-committed"]);
    expect(run.json.error).toContain("b.txt");
  });

  test("an unstaged change in the part's files fails and names the file", async () => {
    const sha = await commit("b.txt");
    await files.write(path.join(worktree, "b.txt"), "unstaged\n");
    const run = await done("--part", "02", "--commit", sha);
    expect([run.code, run.json.code]).toEqual([1, "part-not-committed"]);
    expect(run.json.error).toContain("b.txt");
  });

  test("a part without files needs a clean worktree", async () => {
    const sha = await commit("c.txt");
    const clean = await done("--part", "03", "--commit", sha);
    await files.write(path.join(worktree, "d.txt"), "d\n");
    const dirty = await done("--part", "03", "--commit", sha);
    expect(clean.code).toBe(0);
    expect([dirty.code, dirty.json.code]).toEqual([1, "part-not-committed"]);
  });

  test("a part not in plan.json is unknown-part", async () => {
    const run = await done("--part", "99");
    expect([run.code, run.json.code]).toEqual([1, "unknown-part"]);
  });
});
