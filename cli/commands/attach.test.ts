import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { type CliRun, type FakeClaude, makeFakeClaude, tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;
let fake: FakeClaude;
let real: string;

async function setup(): Promise<void> {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  fake = await makeFakeClaude(project.root);
  await attach("start", "T-1", "--title", "x", "--no-claude");
  real = await files.realPath(path.join(project.wtRoot, "demo", "T-1"));
}

const attach = (...args: string[]): Promise<CliRun> => tenbox(args, project.mainDir, fake.env);

describe("tenbox attach", () => {
  afterEach(async () => {
    await project.remove();
  });

  test("attaches to the newest background session whose cwd is the task worktree", async () => {
    await setup();
    await fake.setSessions([
      { id: "old", cwd: real, kind: "background", startedAt: 1 },
      { id: "new", cwd: real, kind: "background", startedAt: 3 },
      { id: "shell", cwd: real, kind: "interactive", startedAt: 5 },
      { id: "below", cwd: path.join(real, "sub"), kind: "background", startedAt: 9 },
    ]);
    const run = await attach("attach", "T-1");
    const calls = await fake.calls();
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", session: "new" }]);
    expect(calls.map((call) => call.args)).toEqual([
      ["agents", "--json", "--cwd", real],
      ["attach", "new"],
    ]);
  });

  test("with no background session it is no-session and names tenbox build", async () => {
    await setup();
    await fake.setSessions([{ id: "shell", cwd: real, kind: "interactive", startedAt: 5 }]);
    const run = await attach("attach", "T-1");
    const calls = await fake.calls();
    expect([run.code, run.json.code]).toEqual([1, "no-session"]);
    expect(run.json.error).toContain("tenbox build T-1");
    expect(calls.map((call) => call.args[0])).toEqual(["agents"]);
  });
});
