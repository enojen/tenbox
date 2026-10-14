import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { sha256Hex } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;

let project: TempProject;
let planFile: string;
let approvedFile: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  const taskWorktree = path.join(project.wtRoot, "demo", "T-1");
  planFile = path.join(taskWorktree, ".tenbox", "plan.md");
  approvedFile = path.join(taskWorktree, ".tenbox", "approved.json");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
});

afterEach(async () => {
  await project.remove();
});

const approve = (...args: string[]) => tenbox(["approve", ...args], project.mainDir);
async function readApproved(): Promise<unknown> {
  const text = await files.read(approvedFile);
  return JSON.parse(text ?? "null");
}

describe("tenbox approve", () => {
  test("without plan.md it is no-plan and writes nothing", async () => {
    const run = await approve("T-1");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "no-plan"]);
    expect(run.json.error).toContain("plan.md");
    const written = await files.exists(approvedFile);
    expect(written).toBe(false);
  });

  test("with plan.md it writes approved.json with the time and the plan sha", async () => {
    await files.write(planFile, "# plan\n");
    const run = await approve("T-1");
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(run.json).toMatchObject({
      task: "T-1",
      file: approvedFile,
      plan_sha: sha256Hex("# plan\n"),
    });
    const approved = await readApproved();
    expect(approved).toEqual({ at: run.json.at, plan_sha: sha256Hex("# plan\n") });
    expect(Number.isNaN(Date.parse(String(run.json.at)))).toBe(false);
  });

  test("a second run overwrites approved.json", async () => {
    await files.write(planFile, "one\n");
    await approve("T-1");
    await files.write(planFile, "two\n");
    const run = await approve("T-1");
    const approved = await readApproved();
    expect(approved).toEqual({ at: run.json.at, plan_sha: sha256Hex("two\n") });
  });

  test("no id is a usage error", async () => {
    const run = await approve();
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
    expect(run.json.error).toContain("tenbox approve <id>");
  });

  test("a task with no worktree fails", async () => {
    const run = await approve("T-9");
    expect([run.code, run.json.ok]).toEqual([1, false]);
  });

  test("a bad task id is a usage error", async () => {
    const run = await approve("bad id");
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
  });
});
