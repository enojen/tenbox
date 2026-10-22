import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { type CliRun, tenboxInput } from "../test/cli.ts";
import { type FakeNtfy, startFakeNtfy } from "../test/ntfy.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;
let ntfy: FakeNtfy;

beforeEach(async () => {
  ntfy = startFakeNtfy();
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  const taskWorktree = await project.addTaskWorktree("T-1");
  const override = path.join(taskWorktree, ".tenbox", "override.yaml");
  await files.write(override, `notify: { ntfy: "${ntfy.url}" }\n`);
});

afterEach(async () => {
  ntfy.stop();
  await project.remove();
});

const taskWorktree = (): string => path.join(project.wtRoot, "demo", "T-1");

/** `tenbox hook blocked T-1` in the task worktree, as Claude Code runs the hook. */
const hook = (stdin: string): Promise<CliRun> =>
  tenboxInput({ args: ["hook", "blocked", "T-1"], cwd: taskWorktree(), stdin });

const PROMPT = {
  hook_event_name: "Notification",
  notification_type: "permission_prompt",
  session_id: "s",
  cwd: "/somewhere",
};

describe("tenbox hook blocked", () => {
  test("sends one blocked line with the message of the prompt", async () => {
    const message = "Claude needs your permission to use Bash";
    const run = await hook(JSON.stringify({ ...PROMPT, message }));
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", sent: true }]);
    expect(ntfy.lines()).toEqual([`demo · T-1 · blocked · ${message} → tenbox attach T-1`]);
  });

  test("a hook input without message gives the detail permission prompt", async () => {
    const run = await hook(JSON.stringify(PROMPT));
    expect([run.code, run.json.sent]).toEqual([0, true]);
    expect(ntfy.lines()).toEqual(["demo · T-1 · blocked · permission prompt → tenbox attach T-1"]);
  });

  test("stdin that is not JSON or does not fit the hook input sends nothing, exits 0 and logs one line", async () => {
    const texts = ["not json", "[1]", "", JSON.stringify({ ...PROMPT, message: 5 })];
    for (const text of texts) {
      const run = await hook(text);
      const lines = run.err.split("\n").filter((line) => line !== "");
      expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", sent: false }]);
      expect(lines).toHaveLength(1);
    }
    expect(ntfy.lines()).toEqual([]);
  });

  test("without notify.ntfy nothing is sent, the exit is 0 and one line is logged", async () => {
    await files.write(path.join(taskWorktree(), ".tenbox", "override.yaml"), "");
    const run = await hook(JSON.stringify(PROMPT));
    const lines = run.err.split("\n").filter((line) => line !== "");
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", sent: false }]);
    expect(lines).toHaveLength(1);
    expect(ntfy.lines()).toEqual([]);
  });

  test("a task without a worktree exits 0 with sent false", async () => {
    const run = await tenboxInput({
      args: ["hook", "blocked", "T-9"],
      cwd: taskWorktree(),
      stdin: JSON.stringify(PROMPT),
    });
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-9", sent: false }]);
    expect(ntfy.lines()).toEqual([]);
  });

  test("another hook name is a usage error", async () => {
    const run = await tenboxInput({ args: ["hook", "idle", "T-1"], cwd: taskWorktree() });
    expect([run.code, run.json.code]).toEqual([2, "usage"]);
  });
});
