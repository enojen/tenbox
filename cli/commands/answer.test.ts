import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { parseObject } from "../../domain/utils.ts";
import { projectDir } from "../infra/claude/sessionFiles.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { type CliRun, type FakeClaude, type Json, makeFakeClaude, tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const SESSION = "6b17f570-0000-4000-8000-000000000001";
const RUN_ID = "wf_new";

let project: TempProject;
let fake: FakeClaude;
let real: string;

const run = (...args: string[]): Promise<CliRun> => tenbox(args, project.mainDir, fake.env);
const tenboxDir = (): string => path.join(project.wtRoot, "demo", "T-1", ".tenbox");
const scriptPath = (): string => path.join(sessionDir(), "workflows", "scripts", "b.js");
const sessionDir = (): string => path.join(projectDir(env().claudeDir, real), SESSION);

const card = {
  title: "Which store?",
  options: ["files", "sqlite"],
  recommended: 1,
  reason: "r",
  auto: true,
};

const needsYou = {
  status: "needs-you",
  round: 2,
  part: "03",
  proofs: [],
  attention: [],
  nice_to_have: [],
  unproven: [],
  decision: card,
};

async function setup(build: object | null = needsYou): Promise<void> {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  fake = await makeFakeClaude(project.root);
  await run("start", "T-1", "--title", "x", "--no-claude");
  real = await files.realPath(path.join(project.wtRoot, "demo", "T-1"));
  if (build !== null) await run("build", "done", "T-1", "--json", JSON.stringify(build));
}

async function writeBuildRun(): Promise<void> {
  const run = {
    runId: RUN_ID,
    workflowName: "tenbox-build",
    startTime: 1,
    scriptPath: scriptPath(),
    args: "T-1",
  };
  await files.write(path.join(sessionDir(), "workflows", `${RUN_ID}.json`), JSON.stringify(run));
}

async function readText(name: string): Promise<string> {
  const text = await files.read(path.join(tenboxDir(), name));
  return text ?? "";
}

async function readBuild(): Promise<Json | null> {
  const text = await readText("build.json");
  return parseObject(text);
}

describe("tenbox answer", () => {
  afterEach(async () => {
    await project.remove();
  });

  test("records the option, stops the session and resumes the build run with the answer", async () => {
    await setup();
    await writeBuildRun();
    await fake.setSessions([{ id: "6b17f570", cwd: real, kind: "background", startedAt: 1 }]);
    const answered = await run("answer", "T-1", "2");
    expect([answered.code, answered.json]).toEqual([
      0,
      { ok: true, task: "T-1", option: 2, run: RUN_ID, session: SESSION },
    ]);
    const decisions = await readText("decisions.md");
    expect(decisions).toContain("Which store?");
    expect(decisions).toContain("2. sqlite");
    const build = await readBuild();
    expect(build?.answered).toMatchObject({ option: 2, auto: false });
    const calls = await fake.calls();
    const resume = calls.at(-1);
    expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
      ["agents", "--json"],
      ["stop", "6b17f570"],
      ["--bg", "--resume"],
    ]);
    expect(resume?.cwd).toBe(real);
    expect(resume?.args.slice(0, -1)).toEqual(["--bg", "--resume", SESSION, "--"]);
    const prompt = resume?.args.at(-1) ?? "";
    expect(prompt).toContain(RUN_ID);
    expect(prompt).toContain(scriptPath());
    const answer = { round: 2, part: "03", option: 2, text: "sqlite" };
    expect(prompt).toContain(JSON.stringify({ task: "T-1", answer }));
  });

  test("a second answer is answered and changes nothing", async () => {
    await setup();
    await writeBuildRun();
    await run("answer", "T-1", "2");
    const decisions = await readText("decisions.md");
    const second = await run("answer", "T-1", "1");
    expect([second.code, second.json.code]).toEqual([1, "answered"]);
    const after = await readText("decisions.md");
    expect(after).toBe(decisions);
  });

  test("a failed resume leaves the card open, so the same answer can be given again", async () => {
    await setup();
    await writeBuildRun();
    await fake.failWith("resume refused");
    const failed = await run("answer", "T-1", "2");
    expect([failed.code, failed.json.code]).toEqual([1, "claude"]);
    const build = await readBuild();
    expect(build?.answered).toBeUndefined();
    await files.remove(path.join(project.root, "claude.fail"));
    const again = await run("answer", "T-1", "2");
    expect([again.code, again.json.ok]).toEqual([0, true]);
  });

  test("without a needs-you card it is no-decision", async () => {
    await setup({ ...needsYou, status: "ready-for-you", decision: undefined });
    await writeBuildRun();
    const answered = await run("answer", "T-1", "1");
    expect([answered.code, answered.json.code]).toEqual([1, "no-decision"]);
  });

  test("without build.json it is no-decision", async () => {
    await setup(null);
    const answered = await run("answer", "T-1", "1");
    expect([answered.code, answered.json.code]).toEqual([1, "no-decision"]);
  });

  test("without a tenbox-build run file it is no-run and writes nothing", async () => {
    await setup();
    const answered = await run("answer", "T-1", "2");
    expect([answered.code, answered.json.code]).toEqual([1, "no-run"]);
    const decisions = await readText("decisions.md");
    const build = await readBuild();
    expect(decisions).toBe("");
    expect(build?.answered).toBeUndefined();
    const calls = await fake.calls();
    expect(calls).toEqual([]);
  });

  test.each([["3"], ["0"], ["x"]])("option %s is a usage error", async (option) => {
    await setup();
    await writeBuildRun();
    const answered = await run("answer", "T-1", option);
    expect([answered.code, answered.json.code]).toEqual([USAGE_EXIT, "usage"]);
  });
});
