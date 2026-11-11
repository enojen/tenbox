import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { makeFakeClaude, tenbox } from "../test/cli.ts";
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

const USAGE_EXIT = 2;
const DONE_PART =
  "# 01 · x\nstatus: done\nfiles: a.txt\nacceptance:\n- a is built\nresult: built x; commit abc\n";

const partFile = (): string => path.join(worktree, ".tenbox", "parts", "01-x.md");
const reopen = (...flags: string[]) => tenbox(["part", "reopen", "T-1", ...flags], project.mainDir);

describe("tenbox part reopen", () => {
  test("part reopen sets a done part to todo with a new acceptance line and keeps the old result as history", async () => {
    await files.write(partFile(), DONE_PART);
    const run = await reopen("--part", "01", "--accept", "x is checked");
    const file = partFile();
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", part: "01", file }]);
    const text = await files.read(partFile());
    expect(text).toBe(
      "# 01 · x\nstatus: todo\nfiles: a.txt\nacceptance:\n- a is built\n- x is checked\nhistory: built x; commit abc\nresult:\n",
    );
  });

  test("part reopen of an unknown part is unknown-part", async () => {
    await files.write(partFile(), DONE_PART);
    const run = await reopen("--part", "99", "--accept", "a");
    expect([run.code, run.json.code]).toEqual([1, "unknown-part"]);
    const text = await files.read(partFile());
    expect(text).toBe(DONE_PART);
  });

  test("part reopen without --accept is usage", async () => {
    const run = await reopen("--part", "01");
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
    expect(run.json.error).toContain('tenbox part reopen <id> --part NN --accept "..."');
  });

  test("part reopen without --part is usage", async () => {
    const run = await reopen("--accept", "a");
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
  });
});

describe("tenbox part reopen and build", () => {
  test("a reopened part is sent by the next build without a new approval", async () => {
    const fake = await makeFakeClaude(project.root);
    const run = (...args: string[]) => tenbox(args, project.mainDir, fake.env);
    await files.write(path.join(worktree, ".tenbox", "plan.md"), "# plan\n");
    await run("approve", "T-1");
    await files.write(partFile(), DONE_PART);
    await files.write(path.join(worktree, ".tenbox", "parts", "02-y.md"), "status: done\n");
    await files.write(path.join(worktree, ".tenbox", "parts", "03-z.md"), "status: done\n");
    const before = await run("build", "T-1");
    await reopen("--part", "01", "--accept", "a");
    const approved = await run("approved", "T-1");
    const built = await run("build", "T-1");
    expect([before.code, before.json.code]).toEqual([1, "nothing-to-build"]);
    expect(approved.code).toBe(0);
    expect(built.code).toBe(0);
    const sent = String(built.json.sent).replace("/tenbox-build ", "");
    expect(JSON.parse(sent).parts).toEqual([{ id: "01", difficulty: "easy", files: ["a.txt"] }]);
  });
});
