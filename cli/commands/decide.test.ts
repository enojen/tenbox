import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { sha256Hex } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";
import { type FakeClaude, makeFakeClaude, tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const QUESTIONS = "## product\n- [ ] (blocking) Can a shipped order be cancelled?\n- [ ] Other?\n";
const ANSWER = [{ question: "Can a shipped order be cancelled?", answer: "No" }];

let project: TempProject;
let fake: FakeClaude;
let decisionsFile: string;
let questionsFile: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  const dir = path.join(project.wtRoot, "demo", "T-1", ".tenbox");
  decisionsFile = path.join(dir, "decisions.md");
  questionsFile = path.join(dir, "questions.md");
  fake = await makeFakeClaude(project.root);
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
  await files.write(questionsFile, QUESTIONS);
});

afterEach(async () => {
  await project.remove();
});

const decide = (...args: string[]) => tenbox(["decide", "T-1", ...args], project.mainDir, fake.env);
const PLAN = {
  summary: "s",
  estimated_lines: 1,
  parts: [{ id: "01", difficulty: "easy" }],
  examples: [],
  decisions: [
    { title: "Where the list lives", options: ["in memory", "in sqlite"], taken: 1, reason: "r" },
    { title: "How the list is sorted", options: ["by date", "by name"], taken: 1, reason: "r" },
  ],
  lenses: [],
  questions: [],
};
const TAKE = [{ decision: "Where the list", taken: 2 }];
const SENT = `/tenbox-build ${JSON.stringify({ task: "T-1", parts: PLAN.parts, lenses: [] })}`;
const planJsonFile = () => path.join(path.dirname(decisionsFile), "plan.json");
const writePlan = async () => {
  await files.write(path.join(path.dirname(decisionsFile), "plan.md"), "# plan\n");
  await files.writeJson(planJsonFile(), PLAN);
};
const approve = async () => {
  await writePlan();
  await tenbox(["approve", "T-1"], project.mainDir, fake.env);
};
const bgCalls = async () => {
  const calls = await fake.calls();
  return calls.filter((call) => call.args[0] === "--bg");
};
const readFiles = () => Promise.all([files.read(decisionsFile), files.read(questionsFile)]);
const withJson = (items: unknown) => decide("--json", JSON.stringify(items), "--no-build");

describe("tenbox decide", () => {
  test("answers a question, ticks it and leaves the other lines", async () => {
    const run = await withJson(ANSWER);
    expect(run.code).toBe(0);
    expect(run.json).toEqual({ ok: true, task: "T-1", file: decisionsFile, added: 1, ticked: 1 });
    const decisions = await files.read(decisionsFile);
    expect(decisions).toBe("- Can a shipped order be cancelled?\n  Answer: No\n");
    const questions = await files.read(questionsFile);
    expect(questions).toBe(QUESTIONS.replace("- [ ] (blocking)", "- [x] (blocking)"));
  });

  test("a note creates decisions.md and leaves questions.md", async () => {
    await files.remove(decisionsFile);
    const run = await withJson([{ answer: "Use the TMUX note of TEN-364" }]);
    expect([run.code, run.json.added, run.json.ticked]).toEqual([0, 1, 0]);
    const decisions = await files.read(decisionsFile);
    expect(decisions).toBe("- Use the TMUX note of TEN-364\n");
    const questions = await files.read(questionsFile);
    expect(questions).toBe(QUESTIONS);
  });

  test("a second run adds and ticks nothing and changes no byte", async () => {
    await withJson(ANSWER);
    const before = await readFiles();
    const run = await withJson(ANSWER);
    expect([run.code, run.json.added, run.json.ticked]).toEqual([0, 0, 0]);
    const after = await readFiles();
    expect(after).toEqual(before);
  });

  test("an unknown question is unknown-question and nothing is written", async () => {
    const run = await withJson([{ answer: "fine" }, { question: "Nothing like it", answer: "x" }]);
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "unknown-question"]);
    expect(run.json.error).toContain("Nothing like it");
    const written = await files.exists(decisionsFile);
    const questions = await files.read(questionsFile);
    expect([written, questions]).toEqual([false, QUESTIONS]);
  });

  test("a question that fits two lines is unknown-question", async () => {
    const run = await withJson([{ question: "?", answer: "x" }]);
    expect([run.code, run.json.code]).toEqual([1, "unknown-question"]);
  });

  test.each([
    ["not an array", '{"answer":"x"}'],
    ["a blank answer", '[{"answer":" "}]'],
    ["a missing answer", '[{"question":"Other?"}]'],
  ])("--json with %s is bad-decisions and writes nothing", async (_name, json) => {
    const run = await decide("--json", json);
    const started = await bgCalls();
    expect(started).toEqual([]);
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-decisions"]);
    const written = await files.exists(decisionsFile);
    expect(written).toBe(false);
  });

  test("a missing --json is a usage error", async () => {
    const run = await decide();
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
  });

  test("sends the build after the answers", async () => {
    await approve();
    const run = await decide("--json", JSON.stringify(ANSWER));
    const calls = await bgCalls();
    expect([run.code, run.json]).toEqual([
      0,
      {
        ok: true,
        task: "T-1",
        file: decisionsFile,
        added: 1,
        ticked: 1,
        sent: SENT,
      },
    ]);
    expect(calls.map((call) => call.args.at(-1))).toEqual([SENT]);
  });

  test("not-approved comes after the answers are written and starts nothing", async () => {
    const run = await decide("--json", JSON.stringify(ANSWER));
    const decisions = await files.read(decisionsFile);
    expect([run.code, run.json.code]).toEqual([1, "not-approved"]);
    expect(decisions).toBe("- Can a shipped order be cancelled?\n  Answer: No\n");
    const started = await bgCalls();
    expect(started).toEqual([]);
  });

  test("a working session is session-busy after the answers are written", async () => {
    await approve();
    const cwd = await files.realPath(path.dirname(path.dirname(decisionsFile)));
    await fake.setSessions([
      { id: "s1", cwd, kind: "background", startedAt: 1, state: "working", pid: 11 },
    ]);
    const run = await decide("--json", JSON.stringify(ANSWER));
    const decisions = await files.read(decisionsFile);
    expect([run.code, run.json.code]).toEqual([1, "session-busy"]);
    expect(decisions).toContain("Answer: No");
    const started = await bgCalls();
    expect(started).toEqual([]);
  });

  test("a missing --json starts no build", async () => {
    await approve();
    await decide();
    const started = await bgCalls();
    expect(started).toEqual([]);
  });
});

describe("tenbox decide with a plan decision", () => {
  test("takes the option: plan show shows it taken and decisions.md has the note", async () => {
    await writePlan();
    const run = await withJson(TAKE);
    expect([run.code, run.json.ok, run.json.added]).toEqual([0, true, 1]);
    const shown = await tenbox(["plan", "show", "T-1"], project.mainDir, fake.env);
    const [first, second] = PLAN.decisions;
    expect(shown.json.decisions).toEqual([{ ...first, taken: 2 }, second]);
    expect(shown.err).toContain("    * 2. in sqlite (taken)");
    const written = await files.read(decisionsFile);
    expect(written).toBe("- Where the list lives: in sqlite\n");
  });

  test.each([
    ["no card", "Nothing like it"],
    ["two cards", "the list"],
  ])("a decision that fits %s is unknown-decision and writes nothing", async (_name, text) => {
    await writePlan();
    const before = await files.read(planJsonFile());
    const run = await withJson([{ answer: "fine" }, { decision: text, taken: 1 }]);
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "unknown-decision"]);
    expect(run.json.error).toContain(text);
    const after = await files.read(planJsonFile());
    const written = await files.exists(decisionsFile);
    expect([after, written]).toEqual([before, false]);
  });

  test("a taken outside the options is bad-decisions and writes nothing", async () => {
    await writePlan();
    const before = await files.read(planJsonFile());
    const run = await withJson([{ decision: "Where the list", taken: 3 }]);
    expect([run.code, run.json.code]).toEqual([1, "bad-decisions"]);
    const after = await files.read(planJsonFile());
    const written = await files.exists(decisionsFile);
    expect([after, written]).toEqual([before, false]);
  });

  test("an unknown question writes no plan.json change either", async () => {
    await writePlan();
    const before = await files.read(planJsonFile());
    const run = await withJson([...TAKE, { question: "Nothing like it", answer: "x" }]);
    expect([run.code, run.json.code]).toEqual([1, "unknown-question"]);
    const after = await files.read(planJsonFile());
    expect(after).toBe(before);
  });

  test("an approved plan stays approved, with the sha of the new plan.json", async () => {
    await approve();
    await withJson(TAKE);
    const run = await tenbox(["approved", "T-1"], project.mainDir, fake.env);
    const text = await files.read(planJsonFile());
    expect([run.code, run.json.plan_sha]).toEqual([0, sha256Hex(text ?? "")]);
  });

  test("a plan that was not approved gets no approved.json", async () => {
    await writePlan();
    await withJson(TAKE);
    const approved = await files.exists(path.join(path.dirname(decisionsFile), "approved.json"));
    expect(approved).toBe(false);
  });

  test("without plan.json it is no-plan and writes nothing", async () => {
    const run = await withJson(TAKE);
    expect([run.code, run.json.code]).toEqual([1, "no-plan"]);
    const written = await files.exists(decisionsFile);
    expect(written).toBe(false);
  });
});
