import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, symlink } from "node:fs/promises";
import path from "node:path";
import { files } from "../infra/files.ts";
import { type FakeClaude, makeFakeClaude, tenbox } from "../test/cli.ts";
import { checkResult } from "../test/helpers.ts";
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
        reason: null,
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

  test("a failed build gives its reason: feedback, attention, findings and the parts not done", async () => {
    const part = (name: string, text: string) =>
      files.write(path.join(tenboxDir, "parts", `${name}.md`), text);
    await part("01-a", "# 01\nstatus: done\nresult: built a, 2 tests, abc123\n");
    await part("02-b", "# 02\nstatus: doing\nresult: half of b, the check is red\n");
    await part("03-c", "# 03\nstatus: todo\n");
    const finding = { title: "t", why: "w", what: "x", done: "d", labels: [], task: null };
    const failed = buildResult({
      status: "failed",
      round: 4,
      feedback: "1 new failure: test b",
      attention: ["read b.ts"],
      findings: [finding],
    });
    await files.writeJson(path.join(tenboxDir, "build.json"), failed);
    await files.writeJson(path.join(tenboxDir, "task.json"), {
      id: "T-1",
      title: "the title",
      status: "failed",
      tracker: "none",
      url: null,
    });
    const run = await status();
    expect(run.json.reason).toEqual({
      feedback: "1 new failure: test b",
      attention: ["read b.ts"],
      findings: [finding],
      decision: null,
      parts: [
        { part: "02", status: "doing", result: "half of b, the check is red" },
        { part: "03", status: "todo", result: null },
      ],
    });
  });

  test("a blocked build (needs-you) gives its decision card as the reason", async () => {
    await files.write(path.join(tenboxDir, "parts", "01-a.md"), "# 01\nstatus: blocked\n");
    const card = {
      title: "q",
      options: ["a", "b"],
      recommended: 1,
      reason: "r",
      auto: false,
      kind: "scope",
    };
    const blocked = buildResult({ status: "needs-you", part: "01", decision: card });
    await files.writeJson(path.join(tenboxDir, "build.json"), blocked);
    await files.writeJson(path.join(tenboxDir, "task.json"), {
      id: "T-1",
      title: "the title",
      status: "needs-you",
      tracker: "none",
      url: null,
    });
    const run = await status();
    expect(run.json.reason).toEqual({
      feedback: null,
      attention: [],
      findings: [],
      decision: card,
      parts: [{ part: "01", status: "blocked", result: null }],
    });
  });

  test("a ready build has no reason", async () => {
    await files.writeJson(path.join(tenboxDir, "build.json"), buildResult({}));
    const run = await status();
    expect(run.json.reason).toBeNull();
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
