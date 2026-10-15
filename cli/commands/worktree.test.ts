import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { taskId } from "../../domain/ids.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { ensureGroupWorktree, type GroupWorktreeInput } from "./worktree.ts";

const RECIPE = { model: "sonnet", effort: "medium", lenses: [], tier: "fast" };
const group = (id: number, needs: number[]) => ({
  id,
  name: `feat: group ${id}`,
  parts: [String(id).padStart(2, "0")],
  needs,
  recipe: RECIPE,
});

let project: TempProject;
let taskWorktree: string;
let startCwd: string;

const input = (n: number): GroupWorktreeInput => ({ id: taskId("T-1"), group: n });
const groupPath = (n: number) => path.join(project.wtRoot, "demo", `T-1-${n}`);

async function savePlan(needs: number[][]): Promise<void> {
  const plan = {
    summary: "s",
    estimated_lines: 1,
    parts: needs.map((_, i) => ({ id: String(i + 1).padStart(2, "0"), difficulty: "easy" })),
    criteria: [],
    lenses: [],
    questions: [],
    groups: needs.map((n, i) => group(i + 1, n)),
  };
  await files.writeJson(path.join(taskWorktree, ".tenbox", "plan.json"), plan);
}

async function commitFile(dir: string, name: string, text: string): Promise<void> {
  await files.write(path.join(dir, name), text);
  await git.run(["add", name], dir);
  await git.run(["commit", "-q", "-m", `add ${name}`], dir);
}

beforeEach(async () => {
  project = await makeTempProject({
    "tenbox.yaml": JSON.stringify({ project: "demo", setup: "echo ran > setup.txt" }),
    "shared.txt": "base\n",
  });
  taskWorktree = await project.addTaskWorktree("T-1");
  startCwd = process.cwd();
  process.chdir(taskWorktree);
});

afterEach(async () => {
  process.chdir(startCwd);
  await project.remove();
});

describe("ensureGroupWorktree", () => {
  test("a group with no needs gets a worktree on feat/T-1-2 at the base, with setup and start", async () => {
    await savePlan([[], []]);
    const baseSha = await git.run(["rev-parse", "main"], project.mainDir);
    const r = await ensureGroupWorktree(input(2));
    expect(r).toMatchObject({
      ok: true,
      task: "T-1",
      group: 2,
      worktree: groupPath(2),
      branch: "feat/T-1-2",
      created: true,
    });
    const got1 = await git.run(["rev-parse", "HEAD"], groupPath(2));
    expect(got1).toBe(baseSha);
    const got2 = await files.read(path.join(groupPath(2), "setup.txt"));
    expect(got2).toBe("ran\n");
    const link = await files.readLink(path.join(groupPath(2), ".tenbox"));
    const want3 = await files.realPath(path.join(taskWorktree, ".tenbox"));
    expect(link).toBe(want3);
    const saved = await files.read(path.join(taskWorktree, ".tenbox/groups/2/group.json"));
    expect(JSON.parse(saved ?? "{}")).toEqual({ start: baseSha });
  });

  test("a second run reuses the worktree", async () => {
    await savePlan([[], []]);
    await ensureGroupWorktree(input(2));
    const again = await ensureGroupWorktree(input(2));
    expect(again.created).toBe(false);
  });

  test("group 1 is the task worktree", async () => {
    await savePlan([[], []]);
    const r = await ensureGroupWorktree(input(1));
    expect(r).toMatchObject({
      group: 1,
      worktree: taskWorktree,
      branch: "feat/T-1",
      created: false,
    });
  });

  test("a group the plan does not list is unknown-group", async () => {
    await savePlan([[], []]);
    await expect(ensureGroupWorktree(input(9))).rejects.toMatchObject({ code: "unknown-group" });
  });

  test("a group with two needs starts with the commits of both branches", async () => {
    await savePlan([[], [], [1, 2]]);
    await commitFile(taskWorktree, "one.txt", "1\n");
    await ensureGroupWorktree(input(2));
    await commitFile(groupPath(2), "two.txt", "2\n");
    const r = await ensureGroupWorktree(input(3));
    expect(r.created).toBe(true);
    const got4 = await files.read(path.join(groupPath(3), "one.txt"));
    expect(got4).toBe("1\n");
    const got5 = await files.read(path.join(groupPath(3), "two.txt"));
    expect(got5).toBe("2\n");
  });

  test("branches that conflict give merge-conflict and leave no worktree", async () => {
    await savePlan([[], [], [1, 2]]);
    await commitFile(taskWorktree, "shared.txt", "one\n");
    await ensureGroupWorktree(input(2));
    await commitFile(groupPath(2), "shared.txt", "two\n");
    await expect(ensureGroupWorktree(input(3))).rejects.toMatchObject({ code: "merge-conflict" });
    const got6 = await files.isDir(groupPath(3));
    expect(got6).toBe(false);
    const got7 = await git.branchExists(project.mainDir, "feat/T-1-3");
    expect(got7).toBe(false);
  });
});

describe("tenbox worktree", () => {
  test("--group 9 prints unknown-group and exits 1", async () => {
    await savePlan([[], []]);
    const run = await tenbox(["worktree", "T-1", "--group", "9"], taskWorktree);
    expect(run.code).toBe(1);
    expect(run.json).toMatchObject({ ok: false, code: "unknown-group" });
  });

  test("--group 2 prints the worktree", async () => {
    await savePlan([[], []]);
    const run = await tenbox(["worktree", "T-1", "--group", "2"], taskWorktree);
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({ ok: true, group: 2, branch: "feat/T-1-2", created: true });
  });

  test("a missing --group is a usage error", async () => {
    const run = await tenbox(["worktree", "T-1"], taskWorktree);
    expect(run.code).toBe(2);
  });
});
