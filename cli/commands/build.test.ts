import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { hashes } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import {
  type CliRun,
  type FakeClaude,
  type FakeSession,
  makeFakeClaude,
  notificationHooks,
  tenbox,
} from "../test/cli.ts";
import { type FakeNtfy, startFakeNtfy } from "../test/ntfy.ts";
import { readStatus } from "../test/taskStatus.ts";
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
const planJsonFile = (): string => path.join(taskWorktree(), ".tenbox", "plan.json");

const PARTS = [{ id: "01", difficulty: "hard" }];
const RECIPE = { model: "opus", effort: "high", lenses: [], tier: "fast" };
const GROUPS = [{ id: 1, name: "feat: a", parts: ["01"], needs: [], recipe: RECIPE }];

/** A plan result with one part and the contract lens; `groups` only when given. */
const planResult = (groups?: object[]) => ({
  summary: "s",
  estimated_lines: 10,
  parts: PARTS,
  examples: [],
  decisions: [],
  lenses: ["contract"],
  questions: [],
  ...(groups && { groups }),
});

async function approve(plan: object = planResult()): Promise<void> {
  await files.write(planFile(), "# plan\n");
  await files.writeJson(planJsonFile(), plan);
  await run("approve", "T-1");
}

/** The args of a normal plan: its own lenses, three review rounds. */
const ARGS = { task: "T-1", kind: "normal", reviews: 3, parts: PARTS, lenses: ["contract"] };
const SENT = `/tenbox-build ${JSON.stringify(ARGS)}`;

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
    await files.writeJson(planJsonFile(), { ...planResult(), summary: "changed" });
    const changed = await run("build", "T-1");
    expect([unapproved.code, unapproved.json.code]).toEqual([1, "not-approved"]);
    expect([changed.code, changed.json.code]).toEqual([1, "plan-changed"]);
    const prompts = await bgPrompts();
    expect(prompts).toEqual([]);
  });

  test("sends the groups of a plan that has them", async () => {
    await setup();
    await approve(planResult(GROUPS));
    const built = await run("build", "T-1");
    const args = { ...ARGS, groups: GROUPS };
    expect(built.json.sent).toBe(`/tenbox-build ${JSON.stringify(args)}`);
  });

  test("sends the kind, its review rounds and the lenses and recipes the kind gives", async () => {
    await setup();
    const recipe = { ...RECIPE, lenses: ["contract"], tier: "full" };
    const group = { ...GROUPS[0], recipe };
    await approve({ ...planResult([group]), kind: "small" });
    const built = await run("build", "T-1");
    const applied = { ...group, recipe: { ...recipe, lenses: [], tier: "fast" } };
    const args = { ...ARGS, kind: "small", reviews: 1, lenses: [], groups: [applied] };
    expect(built.json.sent).toBe(`/tenbox-build ${JSON.stringify(args)}`);
  });

  test("an approved plan.json that is no longer valid is bad-file and starts nothing", async () => {
    await setup();
    const old = JSON.stringify({ ...planResult(), examples: undefined, criteria: [] });
    await files.write(planJsonFile(), old);
    const approvedJson = path.join(path.dirname(planJsonFile()), "approved.json");
    await files.writeJson(approvedJson, {
      at: new Date().toISOString(),
      plan_sha: hashes.sha256Hex(old),
    });
    const built = await run("build", "T-1");
    const prompts = await bgPrompts();
    expect([built.code, built.json.code]).toEqual([1, "bad-file"]);
    expect(built.json.error).toContain("plan.json");
    expect(prompts).toEqual([]);
  });

  test("starts claude --bg with /tenbox-build and the plan JSON in the task worktree", async () => {
    await setup();
    await approve();
    const built = await run("build", "T-1");
    const real = await files.realPath(taskWorktree());
    const calls = await fake.calls();
    expect([built.code, built.json]).toEqual([0, { ok: true, task: "T-1", sent: SENT }]);
    expect(calls.at(-1)?.cwd).toBe(real);
    expect(calls.at(-1)?.args.slice(0, 1)).toEqual(["--bg"]);
    expect(calls.at(-1)?.args.slice(-6)).toEqual([
      "-n",
      "tenbox-T-1",
      "--allowedTools",
      "Workflow",
      "--",
      SENT,
    ]);
  });

  test("starts claude with the Notification hook that runs hook blocked T-1", async () => {
    await setup();
    await approve();
    await run("build", "T-1");
    const calls = await fake.calls();
    const hooks = notificationHooks(calls.at(-1)?.args ?? []);
    expect(hooks?.Notification.map((entry) => entry.matcher)).toEqual(["permission_prompt"]);
    const commands = hooks?.Notification.flatMap((entry) => entry.hooks.map((h) => h.command));
    expect(commands).toHaveLength(1);
    expect(commands?.[0]?.endsWith(" hook blocked T-1")).toBe(true);
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
    expect(prompts).toEqual([SENT]);
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

/** Each check prints its file and fails when the task worktree has it. */
const CHECKS_MANIFEST = `project: demo
checks:
  fast:
    unit: "test ! -f fast.txt || { cat fast.txt; exit 1; }"
  full:
    e2e: "test ! -f full.txt || { cat full.txt; exit 1; }"
`;

/** A fake `gh` that logs its calls and keeps the PRs it creates in `prs.json`. */
const FAKE_GH = `#!/usr/bin/env bun
import fs from "node:fs";
const dir = process.env.GH_FAKE;
const args = process.argv.slice(2);
const db = dir + "/prs.json";
const prs = fs.existsSync(db) ? JSON.parse(fs.readFileSync(db, "utf8")) : [];
const flag = (name) => args[args.indexOf(name) + 1];
fs.appendFileSync(dir + "/calls.log", JSON.stringify(args) + "\\n");
if (args[1] === "create") {
  prs.push({ number: prs.length + 1, url: "https://example.com/pull/1", isDraft: args.includes("--draft"),
    state: "OPEN", headRefName: flag("--head"), body: flag("--body") });
  fs.writeFileSync(db, JSON.stringify(prs));
}
if (args[1] === "list") console.log(JSON.stringify(prs.filter((p) => !args.includes("--head") || p.headRefName === flag("--head"))));
`;
const FAILING_GH = "#!/bin/sh\necho gh is down >&2\nexit 1\n";

describe("tenbox build done", () => {
  let buildJson: string;
  let proofsJson: string;
  let overrideFile: string;

  const proof = (test: string) => ({ part: "01", file: "a.test.ts", test, failure: "got 1" });

  const valid = {
    status: "failed",
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
    project = await makeTempProject({ "tenbox.yaml": CHECKS_MANIFEST, "a.txt": "a\n" });
    const tenboxDir = path.join(project.wtRoot, "demo", "T-1", ".tenbox");
    buildJson = path.join(tenboxDir, "build.json");
    proofsJson = path.join(tenboxDir, "proofs.json");
    overrideFile = path.join(tenboxDir, "override.yaml");
    ghEnv = {};
    await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
  });

  const buildDone = (...args: string[]) =>
    tenbox(["build", "done", "T-1", ...args], project.mainDir, ghEnv);
  let ghEnv: Record<string, string> = {};
  const ghState = (): string => path.join(project.root, "gh-state");

  /** Puts `script` first in `PATH` as `gh`. */
  async function installGh(script: string): Promise<void> {
    const bin = path.join(project.root, "gh-bin");
    await files.write(path.join(bin, "gh"), script);
    await chmod(path.join(bin, "gh"), 0o755);
    await files.write(path.join(ghState(), ".keep"), "");
    ghEnv = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_FAKE: ghState() };
  }

  /** Commits `changed` in the task worktree with an `origin` to push to, then runs `tenbox check`. */
  async function checkedTask(changed: Record<string, string> = { "b.txt": "b\n" }) {
    const origin = path.join(project.root, "origin.git");
    await git.run(["init", "-q", "--bare", origin], project.mainDir);
    await git.run(["remote", "add", "origin", origin], project.mainDir);
    await commit(changed);
    await tenbox(["check", "T-1"], project.mainDir);
  }

  async function commit(changed: Record<string, string>): Promise<void> {
    const dir = path.dirname(path.dirname(buildJson));
    for (const [name, text] of Object.entries(changed))
      await files.write(path.join(dir, name), text);
    await git.run(["add", ...Object.keys(changed)], dir);
    await git.run(["commit", "-q", "-m", "change"], dir);
  }

  const ready = { ...valid, status: "ready-for-you" };
  const readyJson = ["--json", JSON.stringify(ready)];
  const fullChecksJson = (): string =>
    path.join(path.dirname(buildJson), "rounds", "1", "checks-full.json");

  describe("ready-for-you", () => {
    beforeEach(() => installGh(FAKE_GH));

    test("a commit after the last tenbox check is checks-stale and writes no build.json", async () => {
      await checkedTask();
      await commit({ "c.txt": "c\n" });
      const run = await buildDone(...readyJson);
      const written = await files.exists(buildJson);
      expect([run.code, run.json.code, written]).toEqual([1, "checks-stale", false]);
    });

    test("a red checks.json at HEAD is check-failed with its summary and writes no build.json", async () => {
      await checkedTask({ "fast.txt": " FAIL  fast one\n" });
      const run = await buildDone(...readyJson);
      const written = await files.exists(buildJson);
      expect([run.code, run.json.code, written]).toEqual([1, "check-failed", false]);
      expect(run.json.error).toContain("FAIL  fast one");
    });

    test("a plan without groups runs the full tier; a new failure there is check-failed", async () => {
      await checkedTask({ "full.txt": " FAIL  full one\n" });
      const run = await buildDone(...readyJson);
      const written = await files.exists(buildJson);
      const full = await files.exists(fullChecksJson());
      expect([run.code, run.json.code, written, full]).toEqual([1, "check-failed", false, true]);
      expect(run.json.error).toContain("FAIL  full one");
    });

    test("a plan whose only group has tier fast runs no full tier", async () => {
      const recipe = { model: "opus", effort: "high", lenses: [], tier: "fast" };
      const group = { id: 1, name: "feat: a", parts: ["01"], needs: [], recipe };
      const plan = { ...planResult([group]), lenses: [] };
      await files.writeJson(path.join(path.dirname(buildJson), "plan.json"), plan);
      await checkedTask({ "full.txt": " FAIL  full one\n" });
      const run = await buildDone(...readyJson);
      const full = await files.exists(fullChecksJson());
      expect([run.code, run.json.ok, full]).toEqual([0, true, false]);
    });

    /** A `small` plan of one group whose recipe has the given tier. */
    async function smallPlan(tier: string): Promise<void> {
      const recipe = { model: "opus", effort: "high", lenses: [], tier };
      const group = { id: 1, name: "feat: a", parts: ["01"], needs: [], recipe };
      const plan = { ...planResult([group]), kind: "small" };
      await files.writeJson(path.join(path.dirname(buildJson), "plan.json"), plan);
    }

    const lines = (count: number): string => "x\n".repeat(count);

    test("a small plan whose recipe says tier full runs no full tier and keeps kind small", async () => {
      await smallPlan("full");
      await checkedTask({ "full.txt": " FAIL  full one\n" });
      const run = await buildDone(...readyJson);
      const full = await files.exists(fullChecksJson());
      const written = await readJson(buildJson);
      expect([run.code, run.json.ok, full, written.kind]).toEqual([0, true, false, "small"]);
    });

    test("a diff over the small limits is kind-raised and writes nothing; kind normal is accepted", async () => {
      await smallPlan("fast");
      await checkedTask({ "big.txt": lines(101) });
      const raised = await buildDone(...readyJson);
      const written = await files.exists(buildJson);
      expect([raised.code, raised.json.code, written]).toEqual([1, "kind-raised", false]);
      expect(raised.json.details).toEqual({ kind: "normal", lenses: ["contract"], reviews: 3 });
      const accepted = await buildDone("--json", JSON.stringify({ ...ready, kind: "normal" }));
      const saved = await readJson(buildJson);
      expect([accepted.code, saved.kind]).toEqual([0, "normal"]);
    });

    test("a small plan with a diff inside its limits is accepted", async () => {
      await smallPlan("fast");
      await checkedTask({ "b.txt": lines(100) });
      const run = await buildDone(...readyJson);
      expect([run.code, run.json.ok]).toEqual([0, true]);
    });

    test("generated files do not count against the limits of the kind", async () => {
      await smallPlan("fast");
      const attributes = "big.txt linguist-generated\n";
      await checkedTask({ ".gitattributes": attributes, "big.txt": lines(500) });
      const run = await buildDone(...readyJson);
      expect([run.code, run.json.ok]).toEqual([0, true]);
    });

    test("an accepted result writes build.json and opens a draft PR", async () => {
      await checkedTask();
      const run = await buildDone(...readyJson);
      const written = await readJson(buildJson);
      const full = await files.exists(fullChecksJson());
      const calls = await files.read(path.join(ghState(), "calls.log"));
      expect([run.code, run.json.file, written.status, full]).toEqual([
        0,
        buildJson,
        "ready-for-you",
        true,
      ]);
      expect(run.json.pr).toEqual({
        ok: true,
        task: "T-1",
        groups: [
          {
            group: 1,
            branch: "feat/T-1",
            state: "created",
            pr: { number: 1, url: "https://example.com/pull/1", draft: true },
          },
        ],
      });
      expect(calls).toContain('"--draft"');
    });

    test("after an answered card the resumed run's ready-for-you stores each unproven item once", async () => {
      const first = { part: "01", reason: "no test for the empty list" };
      const second = { part: "02", reason: "no test for the sort" };
      await checkedTask();
      const needsYou = await buildDone(
        "--json",
        JSON.stringify({
          status: "needs-you",
          round: 1,
          proofs: [],
          attention: [],
          nice_to_have: [],
          unproven: [first],
          decision: card(false),
        }),
      );
      expect([needsYou.code, needsYou.json.ok]).toEqual([0, true]);
      // Writes `answered` into build.json as `tenbox answer` does (`builds.update`).
      const asked = await readJson(buildJson);
      const answered = { option: 1, at: new Date().toISOString(), auto: false };
      await files.writeJson(buildJson, { ...asked, answered });
      // The resumed run replays the cached round 1 reviewers, so its unproven list holds the first again.
      const resumed = await buildDone(
        "--json",
        JSON.stringify({
          status: "ready-for-you",
          round: 2,
          proofs: [],
          attention: [],
          nice_to_have: [],
          unproven: [first, second],
        }),
      );
      expect([resumed.code, resumed.json.ok]).toEqual([0, true]);
      const saved = await readJson(buildJson);
      expect(saved).toMatchObject({ status: "ready-for-you" });
      expect(saved).toMatchObject({ unproven: [first, second] });
    });

    test("a failing gh keeps build.json and gives pr.ok false", async () => {
      await installGh(FAILING_GH);
      await checkedTask();
      const run = await buildDone(...readyJson);
      const written = await files.exists(buildJson);
      expect([run.code, run.json.ok, written]).toEqual([0, true, true]);
      expect(run.json.pr).toMatchObject({ ok: false, error: expect.stringContaining("gh") });
    });
  });

  test.each(["needs-you", "failed"])(
    "%s is written with no checks and opens no PR",
    async (status) => {
      await installGh(FAKE_GH);
      await commit({ "b.txt": "b\n" });
      const run = await buildDone(...withJson({ status }));
      const calls = await files.exists(path.join(ghState(), "calls.log"));
      expect([run.code, run.json, calls]).toEqual([
        0,
        { ok: true, task: "T-1", file: buildJson },
        false,
      ]);
    },
  );
  const withJson = (change: Record<string, unknown>) => [
    "--json",
    JSON.stringify({ ...valid, ...change }),
  ];
  const readJson = async (file: string) => {
    const text = await files.read(file);
    return JSON.parse(text ?? "null");
  };

  test("the status of task.json becomes the saved build status, a bad result leaves it", async () => {
    const taskJson = path.join(path.dirname(buildJson), "task.json");
    const status = () => readStatus(taskJson);
    await buildDone("--json", "not json");
    const before = await status();
    await buildDone(...withJson({ status: "failed" }));
    const after = await status();
    expect([before, after]).toEqual(["started", "failed"]);
  });

  test("a valid result is written to build.json and its proofs to proofs.json", async () => {
    const run = await buildDone(...withJson({}));
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", file: buildJson }]);
    const written = await readJson(buildJson);
    const recorded = await readJson(proofsJson);
    expect(written).toEqual({ ...valid, kind: "normal" });
    expect(recorded).toEqual([proof("first")]);
  });

  test.each([
    ["an unknown status", withJson({ status: "done" })],
    ["a round that is not whole", withJson({ round: 1.5 })],
    ["a proof with a blank test", withJson({ proofs: [{ ...proof("t"), test: " " }] })],
    ["text that is not JSON", ["--json", "not json"]],
  ])("%s is bad-input and writes nothing", async (_name, args) => {
    const run = await buildDone(...args);
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-input"]);
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
      kind: "normal",
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

  test("a card whose recommended option is not one of its options is bad-input and writes nothing", async () => {
    const run = await buildDone(...withJson({ status: "needs-you", decision: card(true, 3) }));
    expect([run.code, run.json.code]).toEqual([1, "bad-input"]);
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
    "a card with kind %p is bad-input and writes nothing",
    async (kind) => {
      const { kind: _kind, ...rest } = card(true);
      const decision = kind === undefined ? rest : { ...rest, kind };
      const run = await buildDone(...withJson({ status: "needs-you", decision }));
      const buildExists = await files.exists(buildJson);
      expect([run.code, run.json.code, buildExists]).toEqual([1, "bad-input", false]);
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
      ["failed", "demo · T-1 · failed → tenbox attach T-1"],
      ["needs-you", "demo · T-1 · needs-you → tenbox attach T-1"],
    ])("%s sends one line", async (status, line) => {
      const run = await buildDone(...withJson({ status }));
      expect([run.code, run.json.ok]).toEqual([0, true]);
      expect(ntfy.lines()).toEqual([line]);
    });

    test("ready-for-you detail counts round, attention, nice-to-have and unproven", async () => {
      await installGh(FAKE_GH);
      await checkedTask();
      await buildDone(...readyJson);
      expect(ntfy.lines()).toEqual([
        "demo · T-1 · ready-for-you · round 2, attention 1, nice-to-have 1, unproven 1 → tenbox pr T-1 --ready",
        "demo · T-1 · pr-opened · https://example.com/pull/1 → tenbox close T-1",
      ]);
    });

    test("ready-for-you with empty lists shows zero counts", async () => {
      await installGh(FAILING_GH);
      await checkedTask();
      await buildDone(
        ...withJson({
          status: "ready-for-you",
          round: 1,
          attention: [],
          nice_to_have: [],
          unproven: [],
        }),
      );
      expect(ntfy.lines()).toEqual([
        "demo · T-1 · ready-for-you · round 1, attention 0, nice-to-have 0, unproven 0 → tenbox pr T-1 --ready",
      ]);
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
