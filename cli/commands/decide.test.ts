import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const QUESTIONS = "## product\n- [ ] (blocking) Can a shipped order be cancelled?\n- [ ] Other?\n";
const ANSWER = [{ question: "Can a shipped order be cancelled?", answer: "No" }];

let project: TempProject;
let decisionsFile: string;
let questionsFile: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  const dir = path.join(project.wtRoot, "demo", "T-1", ".tenbox");
  decisionsFile = path.join(dir, "decisions.md");
  questionsFile = path.join(dir, "questions.md");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
  await files.write(questionsFile, QUESTIONS);
});

afterEach(async () => {
  await project.remove();
});

const decide = (...args: string[]) => tenbox(["decide", "T-1", ...args], project.mainDir);
const readFiles = () => Promise.all([files.read(decisionsFile), files.read(questionsFile)]);
const withJson = (items: unknown) => decide("--json", JSON.stringify(items));

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
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-decisions"]);
    const written = await files.exists(decisionsFile);
    expect(written).toBe(false);
  });

  test("a missing --json is a usage error", async () => {
    const run = await decide();
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
  });
});
