import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, symlink } from "node:fs/promises";
import path from "node:path";
import { files } from "../infra/files.ts";
import { checkResult } from "../test/checkResult.ts";
import { type FakeClaude, makeFakeClaude, tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const EXECUTABLE = 0o755;

const PLAN = {
  summary: "s",
  estimated_lines: 1,
  parts: [{ id: "01", difficulty: "easy" }],
  examples: [],
  decisions: [],
  lenses: [],
  questions: [],
};
let project: TempProject;
let fake: FakeClaude;
let tenboxDir: string;
let real: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  fake = await makeFakeClaude(project.root);
  await tenbox(["start", "T-1", "--title", "the title", "--no-claude"], project.mainDir);
  const worktree = path.join(project.wtRoot, "demo", "T-1");
  tenboxDir = path.join(worktree, ".tenbox");
  real = await files.realPath(worktree);
});

afterEach(async () => {
  await project.remove();
});

const status = (extraEnv: Record<string, string> = fake.env) =>
  tenbox(["status", "T-1"], project.mainDir, extraEnv);

const buildResult = (extra: object) => ({
  status: "ready-for-you",
  round: 2,
  proofs: [],
  attention: [],
  nice_to_have: [],
  unproven: [],
  ...extra,
});

/** A `gh` in front of PATH that answers `pr list` with the given text. */
async function fakeGh(listOutput: string): Promise<Record<string, string>> {
  const bin = path.join(project.root, "gh-bin");
  await files.write(path.join(bin, "gh"), `#!/bin/sh\necho '${listOutput}'\n`);
  await chmod(path.join(bin, "gh"), EXECUTABLE);
  return { PATH: `${bin}${path.delimiter}${fake.env.PATH}` };
}

describe("tenbox status", () => {
  test("a new task has the status started and nothing done", async () => {
    const run = await status();
    expect([run.code, run.json]).toEqual([
      0,
      {
        ok: true,
        task: "T-1",
        title: "the title",
        status: "started",
        round: null,
        approved: false,
        parts: { todo: 0, doing: 0, done: 0, blocked: 0 },
        session: { state: "none" },
        pr: null,
        checks: null,
      },
    ]);
  });

  test("counts the part files by their status line", async () => {
    const part = (n: string, state: string) =>
      files.write(path.join(tenboxDir, "parts", `${n}-x.md`), `# ${n}\nstatus: ${state}\n`);
    await part("01", "done");
    await part("02", "done");
    await part("03", "blocked");
    await part("04", "todo");
    const run = await status();
    expect(run.json.parts).toEqual({ todo: 1, doing: 0, done: 2, blocked: 1 });
  });

  test("the status follows task.json: approved, then the build result", async () => {
    await files.write(path.join(tenboxDir, "plan.md"), "# plan\n");
    await files.writeJson(path.join(tenboxDir, "plan.json"), PLAN);
    await tenbox(["approve", "T-1"], project.mainDir);
    const approved = await status();
    const card = {
      title: "q",
      options: ["a", "b"],
      recommended: 1,
      reason: "r",
      auto: false,
      kind: "scope",
    };
    const result = buildResult({ status: "needs-you", round: 3, part: "01", decision: card });
    await tenbox(["build", "done", "T-1", "--json", JSON.stringify(result)], project.mainDir);
    const run = await status();
    expect([approved.json.status, run.json.status, run.json.approved, run.json.round]).toEqual([
      "approved",
      "needs-you",
      true,
      3,
    ]);
  });

  test("takes the round and the last check result from the newest checks.json", async () => {
    const checks = (n: number, text: object) =>
      files.writeJson(path.join(tenboxDir, "rounds", String(n), "checks.json"), text);
    await checks(1, checkResult({ ok: false, summary: "1 new failure" }));
    await checks(2, checkResult({ round: 2, summary: "all pass" }));
    const run = await status();
    expect([run.json.round, run.json.checks]).toEqual([
      2,
      { round: 2, ok: true, summary: "all pass" },
    ]);
  });

  test("a checks.json without tier, from before tier was written, is bad-file", async () => {
    const { tier: _, ...old } = checkResult({});
    await files.writeJson(path.join(tenboxDir, "rounds", "1", "checks.json"), old);
    const run = await status();
    expect([run.code, run.json.code]).toEqual([1, "bad-file"]);
  });

  test("reports the state of the newest background session of the task worktree", async () => {
    await fake.setSessions([
      { id: "old", cwd: real, kind: "background", startedAt: 1, state: "done", pid: 1 },
      { id: "new", cwd: real, kind: "background", startedAt: 3, state: "working", pid: 2 },
      {
        id: "other",
        cwd: "/elsewhere",
        kind: "background",
        startedAt: 9,
        state: "blocked",
        pid: 3,
      },
    ]);
    const run = await status();
    expect(run.json.session).toEqual({ state: "working" });
  });

  test("a missing claude is session unavailable, not a failure", async () => {
    const git = Bun.which("git") ?? "git";
    const bin = path.join(project.root, "git-only");
    await files.write(path.join(bin, "keep"), "");
    await symlink(git, path.join(bin, "git"));
    const run = await status({ PATH: bin });
    expect([run.code, run.json.session]).toEqual([0, { state: "unavailable" }]);
  });

  test("shows the open PR of the task branch", async () => {
    const env = await fakeGh(
      '[{"number":7,"url":"https://x/pull/7","isDraft":true,"state":"OPEN","body":"","headRefName":"feat/T-1"}]',
    );
    const run = await status(env);
    expect(run.json.pr).toEqual({ number: 7, url: "https://x/pull/7", draft: true });
  });

  test("an unknown task fails with no-worktree", async () => {
    const run = await tenbox(["status", "T-9"], project.mainDir, fake.env);
    expect([run.code, run.json.code]).toEqual([1, "no-worktree"]);
  });
});
