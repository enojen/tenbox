import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { startFakeNtfy } from "../test/ntfy.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;

let project: TempProject;
let planJson: string;

const valid = {
  summary: "s",
  estimated_lines: 120,
  parts: [
    { id: "01", difficulty: "easy" },
    { id: "02", difficulty: "hard" },
  ],
  criteria: ["c"],
  lenses: [],
  questions: [],
};

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  planJson = path.join(project.wtRoot, "demo", "T-1", ".tenbox", "plan.json");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
});

afterEach(async () => {
  await project.remove();
});

const planDone = (...args: string[]) => tenbox(["plan", "done", "T-1", ...args], project.mainDir);
const withJson = (change: Record<string, unknown>) => [
  "--json",
  JSON.stringify({ ...valid, ...change }),
];

describe("tenbox plan done", () => {
  test("a valid result is written to plan.json", async () => {
    const run = await planDone(...withJson({}));
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", file: planJson }]);
    const text = await files.read(planJson);
    expect(JSON.parse(text ?? "null")).toEqual(valid);
  });

  test.each([
    ["lines that are text", withJson({ estimated_lines: "about 300" })],
    ["a difficulty of medium", withJson({ parts: [{ id: "01", difficulty: "medium" }] })],
    ["a part without an id", withJson({ parts: [{ difficulty: "easy" }] })],
    ["text that is not JSON", ["--json", "not json"]],
    ["a criterion with grep", withJson({ criteria: ["run grep -r foo src"] })],
    ["a criterion with GREP in upper case", withJson({ criteria: ["GREP finds nothing"] })],
  ])("%s is bad-plan and writes nothing", async (_name, args) => {
    const run = await planDone(...args);
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-plan"]);
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
