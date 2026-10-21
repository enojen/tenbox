import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { sha256Hex } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { readStatus } from "../test/taskStatus.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const PLAN_TEXT = JSON.stringify({
  summary: "s",
  estimated_lines: 1,
  parts: [{ id: "01", difficulty: "easy" }],
  examples: [],
  decisions: [],
  lenses: [],
  questions: [],
});

let project: TempProject;
let planFile: string;
let planJsonFile: string;
let approvedFile: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  const taskWorktree = path.join(project.wtRoot, "demo", "T-1");
  planFile = path.join(taskWorktree, ".tenbox", "plan.md");
  planJsonFile = path.join(taskWorktree, ".tenbox", "plan.json");
  approvedFile = path.join(taskWorktree, ".tenbox", "approved.json");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
});

afterEach(async () => {
  await project.remove();
});

const approved = (...args: string[]) => tenbox(["approved", ...args], project.mainDir);
async function approve(): Promise<Record<string, unknown>> {
  await files.write(planFile, "# plan\n");
  await files.write(planJsonFile, PLAN_TEXT);
  const run = await tenbox(["approve", "T-1"], project.mainDir);
  return run.json;
}

describe("tenbox approved", () => {
  test("without approved.json it is not-approved and names tenbox approve", async () => {
    const run = await approved("T-1");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "not-approved"]);
    expect(run.json.error).toContain("tenbox approve T-1");
  });

  test("after tenbox approve it prints the approval", async () => {
    const approval = await approve();
    const run = await approved("T-1");
    expect(run.code).toBe(0);
    expect(run.json).toEqual({
      ok: true,
      task: "T-1",
      file: approvedFile,
      at: approval.at,
      plan_sha: sha256Hex(PLAN_TEXT),
    });
  });

  test("it sets the status building, and a failing run leaves it", async () => {
    const taskJson = path.join(path.dirname(planFile), "task.json");
    const status = () => readStatus(taskJson);
    await approved("T-1");
    const before = await status();
    await approve();
    await approved("T-1");
    const after = await status();
    expect([before, after]).toEqual(["started", "building"]);
  });

  test("a plan.md edited after the approval stays approved", async () => {
    await approve();
    await files.write(planFile, "# plan changed\n");
    const run = await approved("T-1");
    expect([run.code, run.json.ok]).toEqual([0, true]);
  });

  test("a plan.json edited after the approval is plan-changed", async () => {
    await approve();
    await files.write(planJsonFile, `${PLAN_TEXT}\n`);
    const run = await approved("T-1");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "plan-changed"]);
    expect(run.json.error).toContain("plan.json changed after the approval");
    expect(run.json.error).toContain("tenbox approve T-1");
  });

  test("no id is a usage error", async () => {
    const run = await approved();
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
    expect(run.json.error).toContain("tenbox approved <id>");
  });

  test("a task with no worktree fails", async () => {
    const run = await approved("T-9");
    expect([run.code, run.json.ok]).toEqual([1, false]);
  });
});
