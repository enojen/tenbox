import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpath, utimes } from "node:fs/promises";
import path from "node:path";
import { failureLine } from "../../domain/failures.ts";
import { taskId } from "../../domain/ids.ts";
import { env } from "../../infra/env.ts";
import { files } from "../../infra/files.ts";
import { git } from "../../infra/git.ts";
import { baselineStore } from "../../infra/baselineStore.ts";
import { makeTempProject, type TempProject } from "../../test/tempProject.ts";
import { runChecks } from "./check.ts";

const TIMEOUT_MS = 20_000;
const MINUTE_MS = 60_000;
const META = { date: "2026-01-01T00:00:00.000Z", cmd: "check", exit_code: 1 };
const KEY = { project: "demo", check: "unit" };

const lines = (...xs: string[]) => xs.map(failureLine);
const input = (round?: number) => ({
  id: taskId("T-1"),
  timeoutMs: TIMEOUT_MS,
  round,
});

let project: TempProject;
let taskWorktree: string;
let startCwd: string;

/** The check prints `out.txt` of its directory and logs where it ran; `<root>/wt/demo/<dir>` up three levels is the temp root. */
function manifest(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    project: "demo",
    checks: { unit: `cat out.txt; echo "$PWD" >> '../../../calls.txt'; exit 1` },
    ...extra,
  });
}

async function setup(projectFiles: Record<string, string>): Promise<void> {
  project = await makeTempProject({ "out.txt": " FAIL  old\n", ...projectFiles });
  taskWorktree = await project.addTaskWorktree("T-1");
  startCwd = process.cwd();
  process.chdir(taskWorktree);
}

const writeOut = (text: string) => files.write(path.join(taskWorktree, "out.txt"), text);
async function calls(): Promise<string[]> {
  const text = await files.read(path.join(project.root, "calls.txt"));
  return (text ?? "").split("\n").filter((line) => line.length > 0);
}

async function realDirs(...dirs: string[]): Promise<string[]> {
  return Promise.all(dirs.map((dir) => realpath(dir)));
}
const baseShaOf = () => git.run(["rev-parse", "HEAD"], project.mainDir);

afterEach(async () => {
  process.chdir(startCwd);
  await project.remove();
});
describe("runChecks", () => {
  beforeEach(() => setup({ "tenbox.yaml": manifest() }));

  test("no baseline yet: takes one in main, old failures are not new", async () => {
    const baseSha = await baseShaOf();
    const r = await runChecks(input());
    expect(r.ok).toBe(true);
    expect(r.round).toBe(1);
    expect(r.checks[0]).toMatchObject({
      name: "unit",
      failures: 1,
      new_failures: [],
      baseline: { sha: baseSha, source: "main", failures: 1 },
    });
    const ran = await calls();
    const expectedDirs = await realDirs(taskWorktree, project.mainDir);
    const saved = await files.read(
      path.join(env().baselinesRoot, "demo", "unit", `${baseSha}.txt`),
    );
    const written = await files.read(path.join(taskWorktree, ".tenbox/rounds/1/checks.json"));
    expect(ran).toEqual(expectedDirs);
    expect(saved).toBe("FAIL  old\n");
    expect(written).toContain('"ok": true');
    expect(r.file).toBe(path.join(".tenbox", "rounds", "1", "checks.json"));
  });

  test("exact baseline present: a new line fails, round continues", async () => {
    const baseSha = await baseShaOf();
    await baselineStore.save(KEY, { sha: baseSha, lines: lines("FAIL  old") }, META);
    await writeOut(" FAIL  old\n FAIL  new\n");
    await files.mkdir(path.join(taskWorktree, ".tenbox/rounds/1"));
    const r = await runChecks(input());
    expect(r.ok).toBe(false);
    expect(r.round).toBe(2);
    expect(r.checks[0]).toMatchObject({
      new_failures: ["FAIL  new"],
      fixed: [],
      baseline: { source: "exact" },
    });
    expect(r.summary).toBe("unit: 1 new failure(s)\n  FAIL  new");
    const ran = await calls();
    const expectedDirs = await realDirs(taskWorktree);
    expect(ran).toEqual(expectedDirs);
  });

  test("main moved on and no exact baseline: newest by mtime, given round kept", async () => {
    await baselineStore.save(KEY, { sha: "old1", lines: lines("FAIL  x") }, META);
    await baselineStore.save(KEY, { sha: "old2", lines: lines() }, META);
    const past = new Date(Date.now() - MINUTE_MS);
    await utimes(path.join(env().baselinesRoot, "demo", "unit", "old1.txt"), past, past);
    await git.run(["commit", "-q", "--allow-empty", "-m", "moved"], project.mainDir);
    await writeOut(" FAIL  x\n");
    const r = await runChecks(input(7));
    expect(r.round).toBe(7);
    expect(r.checks[0]).toMatchObject({
      baseline: { sha: "old2", source: "newest", failures: 0 },
      new_failures: ["FAIL  x"],
    });
    const ran = await calls();
    const expectedDirs = await realDirs(taskWorktree);
    expect(ran).toEqual(expectedDirs);
  });
});

describe("runChecks commits", () => {
  beforeEach(() => setup({ "tenbox.yaml": manifest() }));

  test("a base that does not exist is no-base", async () => {
    const run = runChecks({ ...input(), base: "nope" });
    await expect(run).rejects.toMatchObject({ code: "no-base" });
  });

  test("a base with no common ancestor is no-base", async () => {
    await git.run(["checkout", "-q", "--orphan", "island"], taskWorktree);
    await git.run(["commit", "-q", "--allow-empty", "-m", "island"], taskWorktree);
    const run = runChecks(input());
    await expect(run).rejects.toMatchObject({ code: "no-base" });
  });

  test("a branch without a commit is no-head", async () => {
    await git.run(["checkout", "-q", "--orphan", "empty"], taskWorktree);
    const run = runChecks(input());
    await expect(run).rejects.toMatchObject({ code: "no-head" });
  });
});

describe("runChecks manifest", () => {
  test("the manifest's failure_pattern replaces the default", async () => {
    await setup({
      "tenbox.yaml": manifest({ failure_pattern: "(^|\\s)FAILED(\\s|$)" }),
      "out.txt": "FooTest > bar() FAILED\n FAIL  ignored\n",
    });
    const r = await runChecks(input());
    expect(r.checks[0]).toMatchObject({
      failures: 1,
      new_failures: [],
      baseline: { source: "main", failures: 1 },
    });
    await writeOut("FooTest > baz() FAILED\n");
    const second = await runChecks(input());
    expect(second.checks[0]).toMatchObject({
      failures: 1,
      new_failures: ["FooTest > baz() FAILED"],
    });
  });

  test("no checks anywhere is an error", async () => {
    await setup({ "tenbox.yaml": JSON.stringify({ project: "demo" }) });
    await expect(runChecks(input())).rejects.toMatchObject({ code: "no-checks" });
  });
});
