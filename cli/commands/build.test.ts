import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import {
  type CliRun,
  type FakeClaude,
  type FakeSession,
  makeFakeClaude,
  tenbox,
} from "../test/cli.ts";
import { type FakeNtfy, startFakeNtfy } from "../test/ntfy.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;
let fake: FakeClaude;

async function setup(): Promise<void> {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  fake = await makeFakeClaude(project.root);
  await run("start", "T-1", "--title", "x", "--no-claude");
}

const run = (...args: string[]): Promise<CliRun> => tenbox(args, project.mainDir, fake.env);
const taskWorktree = (): string => path.join(project.wtRoot, "demo", "T-1");
const planFile = (): string => path.join(taskWorktree(), ".tenbox", "plan.md");

async function approve(): Promise<void> {
  await files.write(planFile(), "# plan\n");
  await run("approve", "T-1");
}

/** The prompts of the `claude --bg` calls: the last argument of each. */
async function bgPrompts(): Promise<string[]> {
  const calls = await fake.calls();
  const bg = calls.filter((call) => call.args[0] === "--bg");
  return bg.map((call) => call.args.at(-1) ?? "");
}

describe("tenbox build", () => {
  afterEach(async () => {
    await project.remove();
  });

  test("refuses an unapproved or changed plan and starts nothing", async () => {
    await setup();
    const unapproved = await run("build", "T-1");
    await approve();
    await files.write(planFile(), "# changed\n");
    const changed = await run("build", "T-1");
    expect([unapproved.code, unapproved.json.code]).toEqual([1, "not-approved"]);
    expect([changed.code, changed.json.code]).toEqual([1, "plan-changed"]);
    const prompts = await bgPrompts();
    expect(prompts).toEqual([]);
  });

  test("starts claude --bg with /tenbox-build <id> in the task worktree", async () => {
    await setup();
    await approve();
    const built = await run("build", "T-1");
    const real = await files.realPath(taskWorktree());
    const calls = await fake.calls();
    expect([built.code, built.json]).toEqual([
      0,
      { ok: true, task: "T-1", sent: "/tenbox-build T-1" },
    ]);
    expect(calls.at(-1)?.cwd).toBe(real);
    expect(calls.at(-1)?.args.slice(0, 1)).toEqual(["--bg"]);
    expect(calls.at(-1)?.args.slice(-6)).toEqual([
      "-n",
      "tenbox-T-1",
      "--allowedTools",
      "Workflow",
      "--",
      "/tenbox-build T-1",
    ]);
  });

  const session = (cwd: string, state: string): FakeSession => ({
    id: "s1",
    cwd,
    kind: "background",
    startedAt: 1,
    state,
    pid: 11,
  });

  test("a working session of the task worktree is session-busy", async () => {
    await setup();
    await approve();
    const real = await files.realPath(taskWorktree());
    await fake.setSessions([session(real, "working")]);
    const built = await run("build", "T-1");
    const prompts = await bgPrompts();
    expect([built.code, built.json.code]).toEqual([1, "session-busy"]);
    expect(built.json.error).toContain("tenbox attach T-1");
    expect(prompts).toEqual([]);
  });

  test.each([
    ["a done session", "done", true],
    ["a blocked session (a planner waiting for its plan to be read)", "blocked", true],
    ["a busy session in another directory", "working", false],
  ])("%s does not block the build", async (_name, state, here) => {
    await setup();
    await approve();
    const real = await files.realPath(taskWorktree());
    await fake.setSessions([session(here ? real : project.root, state)]);
    const built = await run("build", "T-1");
    const prompts = await bgPrompts();
    expect([built.code, built.json.ok]).toEqual([0, true]);
    expect(prompts).toEqual(["/tenbox-build T-1"]);
  });

  test("a claude --bg that fails gives its message", async () => {
    await setup();
    await approve();
    await fake.failWith("Workspace not trusted. Run `claude` once.");
    const built = await run("build", "T-1");
    expect([built.code, built.json.code]).toEqual([1, "claude"]);
    expect(built.json.error).toContain("Workspace not trusted");
  });
});

const USAGE_EXIT = 2;

describe("tenbox build done", () => {
  let buildJson: string;
  let proofsJson: string;
  let overrideFile: string;

  const proof = (test: string) => ({ part: "01", file: "a.test.ts", test, failure: "got 1" });

  const valid = {
    status: "ready-for-you",
    round: 2,
    proofs: [proof("first")],
    attention: ["a"],
    nice_to_have: ["n"],
    unproven: [{ part: "01", reason: "r1" }],
    questions: ["kept"],
  };

  afterEach(async () => {
    await project.remove();
  });

  beforeEach(async () => {
    project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
    const tenboxDir = path.join(project.wtRoot, "demo", "T-1", ".tenbox");
    buildJson = path.join(tenboxDir, "build.json");
    proofsJson = path.join(tenboxDir, "proofs.json");
    overrideFile = path.join(tenboxDir, "override.yaml");
    await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
  });

  const buildDone = (...args: string[]) =>
    tenbox(["build", "done", "T-1", ...args], project.mainDir);
  const withJson = (change: Record<string, unknown>) => [
    "--json",
    JSON.stringify({ ...valid, ...change }),
  ];
  const readJson = async (file: string) => {
    const text = await files.read(file);
    return JSON.parse(text ?? "null");
  };

  test("a valid result is written to build.json and its proofs to proofs.json", async () => {
    const run = await buildDone(...withJson({}));
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", file: buildJson }]);
    const written = await readJson(buildJson);
    const recorded = await readJson(proofsJson);
    expect(written).toEqual(valid);
    expect(recorded).toEqual([proof("first")]);
  });

  test.each([
    ["an unknown status", withJson({ status: "done" })],
    ["a round that is not whole", withJson({ round: 1.5 })],
    ["a proof with a blank test", withJson({ proofs: [{ ...proof("t"), test: " " }] })],
    ["text that is not JSON", ["--json", "not json"]],
  ])("%s is bad-build and writes nothing", async (_name, args) => {
    const run = await buildDone(...args);
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-build"]);
    const buildExists = await files.exists(buildJson);
    const proofsExist = await files.exists(proofsJson);
    expect([buildExists, proofsExist]).toEqual([false, false]);
  });

  test("a second result keeps the earlier unproven items first and appends proofs", async () => {
    await buildDone(...withJson({}));
    const second = {
      status: "failed",
      round: 3,
      proofs: [proof("second")],
      attention: [],
      nice_to_have: [],
      unproven: [{ part: "02", reason: "r2" }],
    };
    await buildDone("--json", JSON.stringify(second));
    const written = await readJson(buildJson);
    const recorded = await readJson(proofsJson);
    expect(written).toEqual({
      ...second,
      unproven: [
        { part: "01", reason: "r1" },
        { part: "02", reason: "r2" },
      ],
    });
    expect(recorded).toEqual([proof("first"), proof("second")]);
  });

  const THIRTY_MINUTES_MS = 1_800_000;
  const card = (auto: boolean, recommended = 1, kind = "scope") => ({
    title: "Which store?",
    options: ["files", "sqlite"],
    recommended,
    reason: "r",
    auto,
    kind,
  });

  test("a needs-you card with auto is written with a deadline 30 minutes after the call", async () => {
    const before = Date.now();
    await buildDone(...withJson({ status: "needs-you", decision: card(true) }));
    const after = Date.now();
    const written = await readJson(buildJson);
    const deadline = Date.parse(written.deadline);
    expect(deadline).toBeGreaterThanOrEqual(before + THIRTY_MINUTES_MS);
    expect(deadline).toBeLessThanOrEqual(after + THIRTY_MINUTES_MS);
    expect(written.decision).toEqual(card(true));
  });

  test("a needs-you card without auto is written with a null deadline", async () => {
    await buildDone(...withJson({ status: "needs-you", decision: card(false) }));
    const written = await readJson(buildJson);
    expect(written.deadline).toBeNull();
  });

  test("a card whose recommended option is not one of its options is bad-build and writes nothing", async () => {
    const run = await buildDone(...withJson({ status: "needs-you", decision: card(true, 3) }));
    expect([run.code, run.json.code]).toEqual([1, "bad-build"]);
    const buildExists = await files.exists(buildJson);
    expect(buildExists).toBe(false);
  });

  test("a never-auto card with auto true is written with a null deadline and starts no timer", async () => {
    await buildDone(...withJson({ status: "needs-you", decision: card(true, 1, "migration") }));
    const written = await readJson(buildJson);
    const log = await files.exists(path.join(path.dirname(buildJson), "auto-answer.log"));
    expect(written.deadline).toBeNull();
    expect(log).toBe(false);
  });

  test.each([undefined, "foo"])(
    "a card with kind %p is bad-build and writes nothing",
    async (kind) => {
      const { kind: _kind, ...rest } = card(true);
      const decision = kind === undefined ? rest : { ...rest, kind };
      const run = await buildDone(...withJson({ status: "needs-you", decision }));
      const buildExists = await files.exists(buildJson);
      expect([run.code, run.json.code, buildExists]).toEqual([1, "bad-build", false]);
    },
  );

  test("a missing --json is a usage error", async () => {
    const run = await buildDone();
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
    expect(run.json.error).toContain("tenbox build done <id> --json");
  });

  describe("notifications", () => {
    let ntfy: FakeNtfy;
    const useNtfy = (url: string) => files.write(overrideFile, `notify: { ntfy: "${url}" }\n`);
    beforeEach(async () => {
      ntfy = startFakeNtfy();
      await useNtfy(ntfy.url);
    });
    afterEach(() => ntfy.stop());

    test.each([
      ["ready-for-you", "demo · T-1 · ready-for-you → tenbox pr T-1"],
      ["failed", "demo · T-1 · failed → tenbox attach T-1"],
      ["needs-you", "demo · T-1 · needs-you → tenbox attach T-1"],
    ])("%s sends one line", async (status, line) => {
      const run = await buildDone(...withJson({ status }));
      expect([run.code, run.json.ok]).toEqual([0, true]);
      expect(ntfy.lines()).toEqual([line]);
    });

    test("needs-you with a card shows its title and the answer with the recommended option", async () => {
      await buildDone(...withJson({ status: "needs-you", decision: card(true, 2) }));
      expect(ntfy.lines()).toEqual(["demo · T-1 · needs-you · Which store? → tenbox answer T-1 2"]);
    });

    test("not-approved sends nothing", async () => {
      await buildDone(...withJson({ status: "not-approved" }));
      expect(ntfy.lines()).toEqual([]);
    });

    test("a bad result sends nothing", async () => {
      await buildDone("--json", "not json");
      expect(ntfy.lines()).toEqual([]);
    });

    test("a refused connection leaves the JSON and exit code and writes one stderr line", async () => {
      await useNtfy("http://localhost:1/topic");
      const run = await buildDone(...withJson({}));
      const stderrLines = run.err.split("\n").filter((line) => line.includes("notification"));
      expect([run.code, run.json.ok, stderrLines.length]).toEqual([0, true, 1]);
    });
  });
});
