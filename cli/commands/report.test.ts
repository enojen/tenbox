import { afterEach, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { installFakeGh } from "../test/fakeGh.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;

const draft = [
  "--title",
  "tenbox check counts a flaky line twice",
  "--why",
  "The rerun repeats the line but the count goes up by two.",
  "--what",
  "Count one failure line once per check run.",
  "--done",
  "A check with one flaky line reports flaky: 1.",
];

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
});

afterEach(async () => {
  await project.remove();
});

test("report writes to enojen/tenbox as a bug, with the task and the tenbox commit, and no project name", async () => {
  const gh = await installFakeGh(project.root);
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir, gh.env);
  const taskWorktree = path.join(project.wtRoot, "demo", "T-1");
  const run = await tenbox(["report", ...draft], taskWorktree, gh.env);
  expect(run.json).toEqual({
    ok: true,
    task: "1",
    url: "https://github.com/enojen/tenbox/issues/1",
    created: true,
  });
  const [issue] = await gh.issues("enojen/tenbox");
  expect(issue?.labels).toEqual(["bug"]);
  expect(issue?.body).toMatch(/^\*\*Why\*\*\n/);
  expect(issue?.body).toMatch(/\n\nFound by task T-1 on tenbox [0-9a-f]{7}\.$/);
  expect(issue?.body).not.toContain("demo");
  expect(run.err).toContain("reported enojen/tenbox#1 · https://github.com/enojen/tenbox/issues/1");
});

test("outside a task worktree the origin names only the tenbox commit", async () => {
  const gh = await installFakeGh(project.root);
  await tenbox(["report", ...draft], project.mainDir, gh.env);
  const [issue] = await gh.issues("enojen/tenbox");
  expect(issue?.body).toMatch(/\n\nFound on tenbox [0-9a-f]{7}\.$/);
});

test("--label replaces bug; inside a Claude Code session agent comes too, and bug stays without a kind", async () => {
  const gh = await installFakeGh(project.root);
  const env = { ...gh.env, CLAUDECODE: "1" };
  await tenbox(["report", ...draft, "--label", "feature"], project.mainDir, env);
  await tenbox(["report", ...draft, "--title", "Another"], project.mainDir, env);
  const [withKind, withoutKind] = await gh.issues("enojen/tenbox");
  expect(withKind?.labels).toEqual(["feature", "agent"]);
  expect(withoutKind?.labels).toEqual(["bug", "agent"]);
});

test("--repo tenyard writes to enojen/tenyard; another name is a usage error", async () => {
  const gh = await installFakeGh(project.root);
  const run = await tenbox(["report", ...draft, "--repo", "tenyard"], project.mainDir, gh.env);
  expect(run.json.url).toBe("https://github.com/enojen/tenyard/issues/1");
  const tenbox_ = await gh.issues("enojen/tenbox");
  expect(tenbox_).toEqual([]);
  const bad = await tenbox(["report", ...draft, "--repo", "other"], project.mainDir, gh.env);
  expect(bad.code).toBe(2);
  expect(bad.json.error).toBe("--repo must be tenbox or tenyard");
});

test("a login without push access sets no label and names them on the first line of the body", async () => {
  const gh = await installFakeGh(project.root, true);
  const run = await tenbox(["report", ...draft], project.mainDir, gh.env);
  expect(run.json.created).toBe(true);
  const [issue] = await gh.issues("enojen/tenbox");
  expect(issue?.labels).toEqual([]);
  expect(issue?.body).toMatch(/^Suggested labels: bug\n\n\*\*Why\*\*\n/);
  const calls = await gh.calls();
  expect(calls).not.toContain("label create");
});

test("a repeated title returns the open issue instead of a second one", async () => {
  const gh = await installFakeGh(project.root);
  await tenbox(["report", ...draft], project.mainDir, gh.env);
  const run = await tenbox(["report", ...draft], project.mainDir, gh.env);
  expect(run.json.created).toBe(false);
  expect(run.json.task).toBe("1");
});

test("without a section it refuses with bad-input before any gh call", async () => {
  const gh = await installFakeGh(project.root);
  const run = await tenbox(["report", "--title", "T"], project.mainDir, gh.env);
  expect(run.code).toBe(1);
  expect(run.json.code).toBe("bad-input");
  const calls = await gh.calls();
  expect(calls).toBe("");
});

test("report needs no tracker and no tenbox.yaml tracker setting", async () => {
  const gh = await installFakeGh(project.root);
  await files.write(
    path.join(project.mainDir, "tenbox.yaml"),
    "project: demo\ntracker: { kind: linear }\n",
  );
  const run = await tenbox(["report", ...draft], project.mainDir, gh.env);
  expect(run.json.created).toBe(true);
});
