import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { files } from "../infra/files.ts";
import { GH_STATE, type GhPrState } from "../infra/gh.ts";
import { git } from "../infra/git.ts";
import { type CliRun, tenbox } from "../test/cli.ts";
import { startFakeNtfy } from "../test/ntfy.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;
let origin: string;
let taskWorktree: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  origin = await mkdtemp(path.join(os.tmpdir(), "tenbox-origin-"));
  await git.run(["init", "-q", "--bare", origin], project.mainDir);
  await git.run(["remote", "add", "origin", origin], project.mainDir);
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
  taskWorktree = path.join(project.wtRoot, "demo", "T-1");
});

afterEach(async () => {
  await rm(origin, { recursive: true, force: true });
  await project.remove();
});

const originBranches = () => git.run(["branch", "--list"], origin);

test("a dirty worktree is refused and nothing is pushed", async () => {
  await files.write(path.join(taskWorktree, "new.txt"), "x\n");
  const run = await tenbox(["pr", "T-1"], project.mainDir);
  const branches = await originBranches();
  expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "dirty"]);
  expect(branches).toBe("");
});

test("a branch with no commits ahead of main is refused and nothing is pushed", async () => {
  const gh = await installGh();
  const run = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const branches = await originBranches();
  expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "no-commits"]);
  expect(branches).toBe("");
});

const FAKE_GH = `#!/usr/bin/env bun
import fs from "node:fs";
const dir = process.env.GH_FAKE;
const args = process.argv.slice(2);
const db = dir + "/prs.json";
const prs = fs.existsSync(db) ? JSON.parse(fs.readFileSync(db, "utf8")) : [];
const flag = (name) => args[args.indexOf(name) + 1];
fs.appendFileSync(dir + "/calls.log", JSON.stringify(args) + "\\n");
const save = () => fs.writeFileSync(db, JSON.stringify(prs));
if (args[0] === "pr" && args[1] === "create") {
  const number = prs.length + 1;
  prs.push({ number, url: "https://example.com/pull/" + number, isDraft: args.includes("--draft"),
    state: "OPEN", headRefName: flag("--head"), title: flag("--title"), body: flag("--body") });
  save();
}
if (args[0] === "pr" && args[1] === "list") {
  const head = args.includes("--head") ? flag("--head") : null;
  const open = args.includes("--state") && flag("--state") === "open";
  console.log(JSON.stringify(prs.filter((p) => (!head || p.headRefName === head) && (!open || p.state === "OPEN"))));
}
if (args[0] === "api" && args.includes("PATCH")) {
  const pr = prs.find((p) => args.some((a) => a.endsWith("/pulls/" + p.number)));
  for (const a of args) {
    if (a.startsWith("title=")) pr.title = a.slice(6);
    if (a.startsWith("body=")) pr.body = a.slice(5);
  }
  save();
}
`;

async function installGh() {
  const bin = path.join(project.root, "bin");
  const state = path.join(project.root, "gh-state");
  await files.write(path.join(bin, "gh"), FAKE_GH);
  await chmod(path.join(bin, "gh"), 0o755);
  await files.write(path.join(state, ".keep"), "");
  const db = path.join(state, "prs.json");
  const read = async (): Promise<Record<string, unknown>[]> => {
    const text = await files.read(db);
    return JSON.parse(text ?? "[]");
  };
  return {
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_FAKE: state },
    prs: read,
    setState: async (branch: string, next: GhPrState) => {
      const prs = await read();
      for (const pr of prs) if (pr.headRefName === branch) pr.state = next;
      await files.write(db, JSON.stringify(prs));
    },
  };
}

async function commit(dir: string, name: string): Promise<void> {
  await files.write(path.join(dir, name), `${name}\n`);
  await git.run(["add", name], dir);
  await git.run(["commit", "-q", "-m", name], dir);
}

const GroupRowsSchema = z.array(z.object({ group: z.number(), state: z.string() }));

const rows = (run: CliRun) => GroupRowsSchema.parse(run.json.groups);
const states = (run: CliRun) => rows(run).map((g) => [g.group, g.state]);

const RECIPE = { model: "sonnet", effort: "medium", lenses: [], tier: "fast" };

async function writeGroupPlan(): Promise<void> {
  const plan = {
    summary: "s",
    estimated_lines: 10,
    parts: [
      { id: "01", difficulty: "easy" },
      { id: "02", difficulty: "easy" },
    ],
    criteria: [],
    lenses: [],
    questions: [],
    groups: [
      { id: 1, name: "feat: first", parts: ["01"], needs: [], recipe: RECIPE },
      { id: 2, name: "feat: second", parts: ["02"], needs: [1], recipe: RECIPE },
    ],
  };
  await files.write(path.join(taskWorktree, ".tenbox", "plan.json"), JSON.stringify(plan));
}

async function makeGroupTask(): Promise<string> {
  await writeGroupPlan();
  const made = await tenbox(["worktree", "T-1", "--group", "2"], project.mainDir);
  const groupWorktree = String(made.json.worktree);
  await commit(taskWorktree, "one.txt");
  await commit(groupWorktree, "two.txt");
  return groupWorktree;
}

test("the PR title comes from task.json, not task.md", async () => {
  const dir = path.join(taskWorktree, ".tenbox");
  const taskText = await files.read(path.join(dir, "task.json"));
  const taskJson = JSON.parse(taskText ?? "null");
  await files.write(path.join(dir, "task.json"), JSON.stringify({ ...taskJson, title: "y" }));
  await commit(taskWorktree, "b.txt");
  const gh = await installGh();
  const run = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const [pr] = await gh.prs();
  expect([run.code, run.json.ok]).toEqual([0, true]);
  expect(pr?.title).toBe("T-1 · y");
});

test("a plan without groups opens one PR whose body starts with the group 1 line", async () => {
  await commit(taskWorktree, "b.txt");
  const gh = await installGh();
  const run = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const [pr] = await gh.prs();
  expect(String(pr?.body).split("\n")[0]).toBe("tenbox: T-1 group 1");
  expect(run.json.groups).toEqual([
    {
      group: 1,
      branch: "feat/T-1",
      state: "created",
      pr: { number: 1, url: "https://example.com/pull/1", draft: true },
    },
  ]);
});

test("a group whose need is not merged waits and its branch is not pushed", async () => {
  await makeGroupTask();
  const gh = await installGh();
  const run = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const prs = await gh.prs();
  expect(states(run)).toEqual([
    [1, "created"],
    [2, "waiting"],
  ]);
  expect(prs.map((p) => p.title)).toEqual(["T-1 · feat: first"]);
  expect(String(prs[0]?.body).split("\n")[0]).toBe("tenbox: T-1 group 1");
  const pushed = await originBranches();
  expect(pushed.includes("feat/T-1-2")).toBe(false);
});

test("a second run updates the PR and sends no notification", async () => {
  const ntfy = startFakeNtfy();
  await files.write(
    path.join(taskWorktree, ".tenbox", "override.yaml"),
    `notify: { ntfy: "${ntfy.url}" }\n`,
  );
  await makeGroupTask();
  const gh = await installGh();
  await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const afterCreate = [...ntfy.lines()];
  const second = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const afterUpdate = [...ntfy.lines()];
  ntfy.stop();
  expect(rows(second)[0]?.state).toBe("updated");
  expect(afterCreate).toEqual([
    "demo · T-1 · pr-opened · https://example.com/pull/1 → tenbox close T-1",
  ]);
  expect(afterUpdate).toEqual(afterCreate);
});

test("a group PR is found by its body line when the head branch differs", async () => {
  await commit(taskWorktree, "b.txt");
  const gh = await installGh();
  const db = path.join(project.root, "gh-state", "prs.json");
  const line = "tenbox: T-1 group 1";
  const other = {
    number: 7,
    url: "https://example.com/pull/7",
    isDraft: false,
    state: GH_STATE.open,
  };
  await files.write(
    db,
    JSON.stringify([{ ...other, headRefName: "renamed", title: "old", body: `${line}\n\ntext` }]),
  );
  const run = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const prs = await gh.prs();
  expect([rows(run)[0]?.state, prs.length, prs[0]?.title]).toEqual(["updated", 1, "T-1 · x"]);
});

test("a PR with no body line is found by its branch", async () => {
  await commit(taskWorktree, "b.txt");
  const gh = await installGh();
  const db = path.join(project.root, "gh-state", "prs.json");
  const old = { number: 3, url: "https://example.com/pull/3", isDraft: true, state: GH_STATE.open };
  await files.write(
    db,
    JSON.stringify([{ ...old, headRefName: "feat/T-1", title: "o", body: "" }]),
  );
  const run = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const prs = await gh.prs();
  expect([rows(run)[0]?.state, prs.length]).toEqual(["updated", 1]);
});

test("a group whose need is merged gets its PR", async () => {
  await makeGroupTask();
  const gh = await installGh();
  await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  await git.run(["push", "-q", "origin", "main"], project.mainDir);
  await gh.setState("feat/T-1", GH_STATE.merged);
  const run = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  expect(states(run)).toEqual([
    [1, "merged"],
    [2, "created"],
  ]);
});

/** Group 2 starts after the commit of group 1, so its branch holds that commit too. */
async function makeStackedGroups(): Promise<string> {
  await writeGroupPlan();
  await commit(taskWorktree, "one.txt");
  const made = await tenbox(["worktree", "T-1", "--group", "2"], project.mainDir);
  const groupWorktree = String(made.json.worktree);
  await commit(groupWorktree, "two.txt");
  return groupWorktree;
}

/** Squash merges group 1 on origin: one commit with its files on main. */
async function squashGroupOne(text: string): Promise<void> {
  await git.run(["push", "-q", "origin", "main"], project.mainDir);
  await files.write(path.join(project.mainDir, "one.txt"), text);
  await git.run(["add", "one.txt"], project.mainDir);
  await git.run(["commit", "-q", "-m", "feat: first (#1)"], project.mainDir);
  await git.run(["push", "-q", "origin", "main"], project.mainDir);
}

test("a waiting group is rebased onto the base after its need is squash merged", async () => {
  await makeStackedGroups();
  const gh = await installGh();
  await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  await squashGroupOne("one.txt\n");
  await gh.setState("feat/T-1", GH_STATE.merged);
  const run = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const own = await git.run(["log", "--format=%s", "main..feat/T-1-2"], origin);
  const prs = await gh.prs();
  expect(states(run)).toEqual([
    [1, "merged"],
    [2, "created"],
  ]);
  expect(own).toBe("two.txt");
  expect(String(prs[1]?.body).split("\n")[0]).toBe("tenbox: T-1 group 2");
});

test("a rebase conflict gives the group conflict with the files and pushes nothing", async () => {
  const groupWorktree = await makeStackedGroups();
  await files.write(path.join(groupWorktree, "one.txt"), "group 2\n");
  await git.run(["commit", "-q", "-am", "edit one"], groupWorktree);
  const before = await git.findHead(groupWorktree);
  const gh = await installGh();
  await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  await squashGroupOne("main\n");
  await gh.setState("feat/T-1", GH_STATE.merged);
  const run = await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const after = await git.findHead(groupWorktree);
  const pushed = await originBranches();
  expect([run.code, run.json.ok]).toEqual([0, true]);
  expect(run.json.groups).toEqual([
    expect.objectContaining({ group: 1, state: "merged" }),
    { group: 2, branch: "feat/T-1-2", state: "conflict", pr: null, files: ["one.txt"] },
  ]);
  expect(after).toBe(before);
  expect(pushed.includes("feat/T-1-2")).toBe(false);
});

test("tenbox pr never merges a PR", async () => {
  await makeStackedGroups();
  const gh = await installGh();
  await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  await squashGroupOne("one.txt\n");
  await gh.setState("feat/T-1", GH_STATE.merged);
  await tenbox(["pr", "T-1"], project.mainDir, gh.env);
  const log = await files.read(path.join(project.root, "gh-state", "calls.log"));
  expect(log?.includes('"merge"')).toBe(false);
});
