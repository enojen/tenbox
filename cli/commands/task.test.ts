import { afterEach, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { type FakeGh, installFakeGh } from "../test/fakeGh.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;

const installGh = (): Promise<FakeGh> => installFakeGh(project.root);

const draft = [
  "--title",
  "Add tenbox login",
  "--why",
  "A box has no login.",
  "--what",
  "Copy the login.",
  "--done",
  "A Job runs claude.",
];

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\ntracker: { kind: github }\n" });
});

afterEach(async () => {
  await project.remove();
});

test("task new writes the issue with the house body and prints its number and url", async () => {
  const gh = await installGh();
  const run = await tenbox(
    ["task", "new", ...draft, "--label", "feature"],
    project.mainDir,
    gh.env,
  );
  expect(run.json).toEqual({
    ok: true,
    task: "1",
    url: "https://github.com/own/repo/issues/1",
    created: true,
  });
  const [issue] = await gh.issues("own/repo");
  expect(issue?.body).toBe(
    "**Why**\nA box has no login.\n\n**What**\nCopy the login.\n\n**Done when**\nA Job runs claude.",
  );
  expect(issue?.labels).toEqual(["feature"]);
  expect(run.err).toContain("opened 1 · https://github.com/own/repo/issues/1");
});

test("a repeated title returns the open issue instead of a second one", async () => {
  const gh = await installGh();
  await tenbox(["task", "new", ...draft], project.mainDir, gh.env);
  const run = await tenbox(["task", "new", ...draft], project.mainDir, gh.env);
  expect(run.json).toEqual({
    ok: true,
    task: "1",
    url: "https://github.com/own/repo/issues/1",
    created: false,
  });
  const issues = await gh.issues("own/repo");
  expect(issues).toHaveLength(1);
});

test("without a section it refuses with bad-input before any gh call", async () => {
  const gh = await installGh();
  const run = await tenbox(["task", "new", "--title", "T", "--why", "w"], project.mainDir, gh.env);
  expect(run.code).toBe(1);
  expect(run.json.code).toBe("bad-input");
  expect(run.json.error).toMatch(/^the task is not valid: what: /);
  const calls = await gh.calls();
  expect(calls).toBe("");
});

test("--json takes the draft as one object", async () => {
  const gh = await installGh();
  const json = JSON.stringify({ title: "T", why: "w", what: "x", done: "d" });
  const run = await tenbox(["task", "new", "--json", json], project.mainDir, gh.env);
  expect(run.json.created).toBe(true);
  expect(run.json.task).toBe("1");
});

test("inside a Claude Code session the issue gets the agent label, made when the repo lacks it", async () => {
  const gh = await installGh();
  const env = { ...gh.env, CLAUDECODE: "1" };
  const run = await tenbox(["task", "new", ...draft], project.mainDir, env);
  expect(run.json.created).toBe(true);
  const [issue] = await gh.issues("own/repo");
  expect(issue?.labels).toEqual(["agent"]);
  const calls = await gh.calls();
  expect(calls).toContain("label create agent");
});

test("without a tracker it refuses with no-tracker and points at tenbox report", async () => {
  await files.write(path.join(project.mainDir, "tenbox.yaml"), "project: demo\n");
  const gh = await installGh();
  const run = await tenbox(["task", "new", ...draft], project.mainDir, gh.env);
  expect(run.code).toBe(1);
  expect(run.json.code).toBe("no-tracker");
  expect(run.json.error).toContain("tenbox report");
});

test("anything but task new is a usage error", async () => {
  const run = await tenbox(["task", "list"], project.mainDir);
  expect(run.code).toBe(2);
  expect(run.json.code).toBe("usage");
});

test("in a task worktree the tracker comes from that worktree's tenbox.yaml, not the main checkout's", async () => {
  const gh = await installGh();
  await files.write(path.join(project.mainDir, "tenbox.yaml"), "project: demo\n");
  const worktree = await project.addTaskWorktree("T-1");
  await files.write(
    path.join(worktree, "tenbox.yaml"),
    "project: demo\ntracker: { kind: github }\n",
  );
  const inMain = await tenbox(["task", "new", ...draft], project.mainDir, gh.env);
  const inWorktree = await tenbox(["task", "new", ...draft], worktree, gh.env);
  expect([inMain.json.code, inWorktree.json.created]).toEqual(["no-tracker", true]);
});
