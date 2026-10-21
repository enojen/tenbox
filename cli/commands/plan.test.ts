import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { startFakeNtfy } from "../test/ntfy.ts";
import { readStatus } from "../test/taskStatus.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const PLAN_MD_LINES = 5;
const PLAN_MD_LIMIT = 60;

let project: TempProject;
let planJson: string;
let planMd: string;

const valid = {
  kind: "small",
  summary: "s",
  estimated_lines: 120,
  parts: [
    { id: "01", difficulty: "easy" },
    { id: "02", difficulty: "hard" },
  ],
  examples: [{ part: "01", title: "lists the tasks", before: "GET /tasks", after: "200 []" }],
  decisions: [
    { title: "Where the list lives", options: ["in memory", "in sqlite"], taken: 2, reason: "r" },
  ],
  lenses: [],
  questions: [{ kind: "product", text: "Sorted by date?", blocking: true }],
};

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  planJson = path.join(project.wtRoot, "demo", "T-1", ".tenbox", "plan.json");
  planMd = path.join(path.dirname(planJson), "plan.md");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
  await files.write(planMd, "# plan\n".repeat(PLAN_MD_LINES));
});

afterEach(async () => {
  await project.remove();
});

const planDone = (...args: string[]) => tenbox(["plan", "done", "T-1", ...args], project.mainDir);
const withJson = (change: Record<string, unknown>) => [
  "--json",
  JSON.stringify({ ...valid, ...change }),
];
const { examples: _examples, ...withoutExamples } = valid;
const [example] = valid.examples;
const [decision] = valid.decisions;

describe("tenbox plan done", () => {
  test("a valid result is written to plan.json", async () => {
    const run = await planDone(...withJson({}));
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", file: planJson }]);
    const text = await files.read(planJson);
    expect(JSON.parse(text ?? "null")).toEqual(valid);
  });

  test("a valid result sets the status plan-ready, a bad one leaves it", async () => {
    const taskJson = path.join(project.wtRoot, "demo", "T-1", ".tenbox", "task.json");
    const status = () => readStatus(taskJson);
    await planDone("--json", "not json");
    const before = await status();
    await planDone(...withJson({}));
    const after = await status();
    expect([before, after]).toEqual(["started", "plan-ready"]);
  });

  test.each([
    ["lines that are text", withJson({ estimated_lines: "about 300" })],
    ["a difficulty of medium", withJson({ parts: [{ id: "01", difficulty: "medium" }] })],
    ["a part without an id", withJson({ parts: [{ difficulty: "easy" }] })],
    ["text that is not JSON", ["--json", "not json"]],
    [
      "criteria and no examples",
      ["--json", JSON.stringify({ ...withoutExamples, criteria: ["c"] })],
    ],
    ["a taken option above the options", withJson({ decisions: [{ ...decision, taken: 3 }] })],
    ["an example of an unknown part", withJson({ examples: [{ ...example, part: "09" }] })],
    ["an example with grep", withJson({ examples: [{ ...example, after: "grep -r foo src" }] })],
  ])("%s is bad-plan and writes nothing", async (_name, args) => {
    const run = await planDone(...args);
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-plan"]);
    const written = await files.exists(planJson);
    expect(written).toBe(false);
  });

  test("a plan.md over the limit is bad-plan, names plan.md and the limit, and writes nothing", async () => {
    await files.write(planMd, "# plan\n".repeat(PLAN_MD_LIMIT + 1));
    const run = await planDone(...withJson({}));
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-plan"]);
    expect(run.json.error).toContain(
      `plan.md has ${PLAN_MD_LIMIT + 1} lines; the limit is ${PLAN_MD_LIMIT}`,
    );
    const written = await files.exists(planJson);
    expect(written).toBe(false);
  });

  test("a missing plan.md is no-plan and writes nothing", async () => {
    await files.remove(planMd);
    const run = await planDone(...withJson({}));
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "no-plan"]);
    expect(run.json.error).toContain("plan.md");
    const written = await files.exists(planJson);
    expect(written).toBe(false);
  });

  test("a plan sends one plan-ready line with the notify.ntfy URL; a bad plan sends none", async () => {
    const ntfy = startFakeNtfy();
    const override = path.join(project.wtRoot, "demo", "T-1", ".tenbox", "override.yaml");
    await files.write(override, `notify: { ntfy: "${ntfy.url}" }\n`);
    const open = { kind: "product", text: "q", blocking: false };
    const blocking = { ...open, blocking: true };
    const questions = [open, blocking, open];
    await planDone("--json", "not json");
    const afterBad = [...ntfy.lines()];
    const run = await planDone(...withJson({ questions }));
    const afterGood = [...ntfy.lines()];
    ntfy.stop();
    expect([run.code, afterBad]).toEqual([0, []]);
    expect(afterGood).toEqual([
      "demo · T-1 · plan-ready · parts 2, open questions 3 (1 blocking) → tenbox approve T-1",
    ]);
  });

  test("a notification links the newest session of the task worktree and none without one", async () => {
    const ntfy = startFakeNtfy();
    const worktree = await realpath(path.join(project.wtRoot, "demo", "T-1"));
    const claudeDir = path.join(project.root, "claude");
    const override = path.join(worktree, ".tenbox", "override.yaml");
    await files.write(override, `notify: { ntfy: "${ntfy.url}" }\n`);
    const env = { CLAUDE_CONFIG_DIR: claudeDir };
    const session = (pid: number, startedAt: number, id: string) =>
      files.write(
        path.join(claudeDir, "sessions", `${pid}.json`),
        JSON.stringify({ pid, cwd: worktree, startedAt, bridgeSessionId: id }),
      );
    const plan = JSON.stringify(valid);
    await tenbox(["plan", "done", "T-1", "--json", plan], worktree, env);
    await session(1300, 1, "session_A");
    await tenbox(["plan", "done", "T-1", "--json", plan], worktree, env);
    await session(1400, 2, "session_B");
    await tenbox(["plan", "done", "T-1", "--json", plan], worktree, env);
    const bodies = ntfy.posts().map((post) => post.body);
    ntfy.stop();
    expect(bodies.map((body) => body?.click)).toEqual([
      undefined,
      "https://claude.ai/code/session_A",
      "https://claude.ai/code/session_B",
    ]);
    expect(Object.keys(bodies[0] ?? {})).not.toContain("click");
  });

  test("a plan without notify.ntfy sends nothing and still succeeds", async () => {
    const run = await planDone(...withJson({}));
    expect([run.code, run.json.ok]).toEqual([0, true]);
  });

  test("a result with groups is written to plan.json", async () => {
    const recipe = { model: "opus", effort: "low", lenses: ["security"], tier: "full" };
    const groups = [
      { id: 1, name: "feat: a", parts: ["01"], needs: [], recipe },
      { id: 2, name: "feat: b", parts: ["02"], needs: [1], recipe },
    ];
    const run = await planDone(...withJson({ groups }));
    expect([run.code, run.json.ok]).toEqual([0, true]);
    const text = await files.read(planJson);
    expect(JSON.parse(text ?? "null").groups).toEqual(groups);
  });

  test("a part in no group is bad-plan and writes nothing", async () => {
    const recipe = { model: "sonnet", effort: "low", lenses: [], tier: "fast" };
    const groups = [{ id: 1, name: "feat: a", parts: ["01"], needs: [], recipe }];
    const run = await planDone(...withJson({ groups }));
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-plan"]);
    const written = await files.exists(planJson);
    expect(written).toBe(false);
  });

  test("a missing --json is a usage error", async () => {
    const run = await planDone();
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
    expect(run.json.error).toContain("tenbox plan done <id> --json");
  });

  test("another sub-command is a usage error", async () => {
    const run = await tenbox(["plan", "foo", "T-1", ...withJson({})], project.mainDir);
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
  });
});

describe("tenbox plan show", () => {
  const show = (...args: string[]) => tenbox(["plan", "show", ...args], project.mainDir);

  test("prints the plan of plan.json on stdout and as lines on stderr", async () => {
    await planDone(...withJson({}));
    const run = await show("T-1");
    expect([run.code, run.json]).toEqual([
      0,
      {
        ok: true,
        task: "T-1",
        file: planJson,
        parts: valid.parts,
        examples: valid.examples,
        decisions: valid.decisions,
        questions: valid.questions,
      },
    ]);
    const lines = run.err.split("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "  01 (easy)",
        "  02 (hard)",
        "  01 · lists the tasks",
        "    before: GET /tasks",
        "    after: 200 []",
        "  Where the list lives",
        "      1. in memory",
        "    * 2. in sqlite (taken)",
        "  [product] (blocking) Sorted by date?",
      ]),
    );
  });

  test("without plan.json it is no-plan", async () => {
    const run = await show("T-1");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "no-plan"]);
  });

  test("no id is a usage error", async () => {
    const run = await show();
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
    expect(run.json.error).toContain("tenbox plan show <id>");
  });
});
