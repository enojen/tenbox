import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { sha256Hex } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { readStatus } from "../test/taskStatus.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const PLAN_MD_LIMIT = 60;
const PLAN = {
  summary: "s",
  estimated_lines: 1,
  parts: [{ id: "01", difficulty: "easy" }],
  examples: [],
  decisions: [],
  lenses: [],
  questions: [],
};
const PLAN_TEXT = `${JSON.stringify(PLAN)}\n`;

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

const approve = (...args: string[]) => tenbox(["approve", ...args], project.mainDir);
async function readApproved(): Promise<unknown> {
  const text = await files.read(approvedFile);
  return JSON.parse(text ?? "null");
}
async function writePlan(planJson: string = PLAN_TEXT): Promise<void> {
  await files.write(planFile, "# plan\n");
  await files.write(planJsonFile, planJson);
}

describe("tenbox approve", () => {
  test("without plan.json it is no-plan and writes nothing", async () => {
    await files.write(planFile, "# plan\n");
    const run = await approve("T-1");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "no-plan"]);
    expect(run.json.error).toContain("plan.json");
    const written = await files.exists(approvedFile);
    expect(written).toBe(false);
  });

  test("without plan.md it is no-plan and writes nothing", async () => {
    await files.write(planJsonFile, PLAN_TEXT);
    const run = await approve("T-1");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "no-plan"]);
    expect(run.json.error).toContain("plan.md");
    const written = await files.exists(approvedFile);
    expect(written).toBe(false);
  });

  test("writes approved.json with the time and the sha of the plan.json text", async () => {
    await writePlan();
    const run = await approve("T-1");
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(run.json).toMatchObject({
      task: "T-1",
      file: approvedFile,
      plan_sha: sha256Hex(PLAN_TEXT),
    });
    const approved = await readApproved();
    expect(approved).toEqual({ at: run.json.at, plan_sha: sha256Hex(PLAN_TEXT) });
    expect(Number.isNaN(Date.parse(String(run.json.at)))).toBe(false);
  });

  test("it sets the status approved, and no plan leaves it", async () => {
    const taskJson = path.join(path.dirname(planFile), "task.json");
    const status = () => readStatus(taskJson);
    await approve("T-1");
    const before = await status();
    await writePlan();
    await approve("T-1");
    const after = await status();
    expect([before, after]).toEqual(["started", "approved"]);
  });

  test("a second run overwrites approved.json", async () => {
    await writePlan();
    await approve("T-1");
    const second = JSON.stringify({ ...PLAN, summary: "two" });
    await writePlan(second);
    const run = await approve("T-1");
    const approved = await readApproved();
    expect(approved).toEqual({ at: run.json.at, plan_sha: sha256Hex(second) });
  });

  test.each([
    ["criteria and no examples", JSON.stringify({ ...PLAN, examples: undefined, criteria: [] })],
    [
      "a taken outside the options",
      JSON.stringify({
        ...PLAN,
        decisions: [{ title: "t", options: ["a", "b"], taken: 3, reason: "r" }],
      }),
    ],
  ])("a hand-written plan.json with %s is bad-plan and writes nothing", async (_name, text) => {
    await writePlan(text);
    const run = await approve("T-1");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-plan"]);
    const written = await files.exists(approvedFile);
    expect(written).toBe(false);
  });

  test("a plan.md over the limit is bad-plan and writes nothing", async () => {
    await writePlan();
    await files.write(planFile, "line\n".repeat(PLAN_MD_LIMIT + 1));
    const run = await approve("T-1");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-plan"]);
    expect(run.json.error).toContain("plan.md");
    const written = await files.exists(approvedFile);
    expect(written).toBe(false);
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
