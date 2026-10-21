import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { type FakeClaude, makeFakeClaude, tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;
let fake: FakeClaude;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  fake = await makeFakeClaude(project.root);
});

afterEach(async () => {
  await project.remove();
});

const list = () => tenbox(["list"], project.mainDir, fake.env);
const start = (id: string) =>
  tenbox(["start", id, "--title", `title ${id}`, "--no-claude"], project.mainDir, fake.env);

describe("tenbox list", () => {
  test("a project with no task worktree gives an empty list", async () => {
    const run = await list();
    expect([run.code, run.json]).toEqual([0, { ok: true, tasks: [] }]);
  });

  test("lists the status report of each task worktree, ordered by id, and a line each on stderr", async () => {
    await start("T-2");
    await start("T-1");
    const done = path.join(project.wtRoot, "demo", "T-2", ".tenbox", "parts", "01-x.md");
    await files.write(done, "# 01\nstatus: done\n");
    const run = await list();
    expect(run.json.tasks).toMatchObject([
      { task: "T-1", status: "started", parts: { done: 0 } },
      { task: "T-2", status: "started", parts: { todo: 0, doing: 0, done: 1, blocked: 0 } },
    ]);
    expect(run.err).toContain("T-1 · started · round - · parts 0/0 · session none · PR -");
    expect(run.err).toContain("T-2 · started · round - · parts 1/1 · session none · PR -");
  });

  test("leaves out main, group worktrees and directories without .tenbox", async () => {
    await start("T-1");
    await files.write(path.join(project.wtRoot, "demo", "T-1-2", ".tenbox", "x"), "");
    await files.write(path.join(project.wtRoot, "demo", "scratch", "x"), "");
    const run = await list();
    expect(run.json.tasks).toMatchObject([{ task: "T-1" }]);
  });
});
