import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpath, utimes } from "node:fs/promises";
import path from "node:path";
import { failureLine } from "../../domain/failures.ts";
import { taskId } from "../../domain/ids.ts";
import type { CheckTier } from "../../domain/manifest.ts";
import { baselineStore } from "../infra/baselineStore.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { tenbox } from "../test/cli.ts";
import { type FakeNtfy, startFakeNtfy } from "../test/ntfy.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { runChecks } from "./check.ts";

const TIMEOUT_MS = 20_000;
const MINUTE_MS = 60_000;
const SHORT_TIMEOUT_MS = 300;
const SLOW_CHECK_SECONDS = 5;
/** What a timed-out check reports, as in coreutils `timeout`. */
const TIMEOUT_EXIT_CODE = 124;
const META = { date: "2026-01-01T00:00:00.000Z", cmd: "check", exit_code: 1 };
const FAST: CheckTier = "fast";
const KEY = { project: "demo", check: "unit" };

const lines = (...xs: string[]) => xs.map(failureLine);
const input = (round?: number) => ({
  base: undefined,
  id: taskId("T-1"),
  timeoutMs: TIMEOUT_MS,
  round,
  tier: FAST,
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

describe("runChecks timeout", () => {
  test("a timed-out check reports exit code 124 in its result and its baseline", async () => {
    await setup({
      "tenbox.yaml": manifest({ checks: { slow: `sleep ${SLOW_CHECK_SECONDS}` } }),
    });
    const baseSha = await baseShaOf();
    const r = await runChecks({ ...input(), timeoutMs: SHORT_TIMEOUT_MS });
    expect(r.checks[0]).toMatchObject({ exit_code: TIMEOUT_EXIT_CODE, timed_out: true });
    const meta = await files.read(
      path.join(env().baselinesRoot, "demo", "slow", `${baseSha}.meta`),
    );
    expect(meta).toContain(`exit_code=${TIMEOUT_EXIT_CODE}\n`);
  });
});

describe("runChecks tiers", () => {
  const tiers = {
    fast: { a: `echo fast >> '../../../calls.txt'` },
    full: { b: `cat out.txt; echo full >> '../../../calls.txt'; exit 1` },
  };

  test("fast runs only the fast checks and says so", async () => {
    await setup({ "tenbox.yaml": manifest({ checks: tiers }) });
    const r = await runChecks(input());
    expect([r.tier, r.checks.map((c) => c.name)]).toEqual(["fast", ["a"]]);
    const ran = await calls();
    expect(ran).not.toContain("full");
    expect(r.file).toBe(path.join(".tenbox", "rounds", "1", "checks.json"));
  });

  test("full runs only the full checks into checks-full.json; a new failure is not ok", async () => {
    await setup({ "tenbox.yaml": manifest({ checks: tiers }) });
    await writeOut(" FAIL  old\n FAIL  new\n");
    const r = await runChecks({ ...input(1), tier: "full" });
    expect([r.ok, r.tier, r.checks.map((c) => c.name)]).toEqual([false, "full", ["b"]]);
    const ran = await calls();
    expect(ran).not.toContain("fast");
    expect(r.file).toBe(path.join(".tenbox", "rounds", "1", "checks-full.json"));
    const written = await files.read(path.join(taskWorktree, r.file));
    expect(written).toContain('"tier": "full"');
  });

  test("a flat manifest has no full checks: ok with none run", async () => {
    await setup({ "tenbox.yaml": manifest() });
    const r = await runChecks({ ...input(1), tier: "full" });
    const ran = await calls();
    expect([r.ok, r.checks, ran]).toEqual([true, [], []]);
  });

  test("full without --round runs in the current round and opens no new one", async () => {
    await setup({ "tenbox.yaml": manifest({ checks: tiers }) });
    await runChecks(input());
    const r = await runChecks({ ...input(), tier: "full" });
    expect(r.file).toBe(path.join(".tenbox", "rounds", "1", "checks-full.json"));
  });

  test("a check in both tiers fails with a manifest error naming it", async () => {
    const both = { fast: { lint: "true" }, full: { lint: "true" } };
    await setup({ "tenbox.yaml": manifest({ checks: both }) });
    await expect(runChecks(input())).rejects.toThrow(/lint/);
  });

  test("an unknown --tier is a usage error", async () => {
    await setup({ "tenbox.yaml": manifest({ checks: tiers }) });
    const r = await tenbox(["check", "T-1", "--tier", "other"], taskWorktree);
    expect(r.code).toBe(2);
  });
});

describe("notifications", () => {
  let ntfy: FakeNtfy;
  beforeEach(async () => {
    ntfy = startFakeNtfy();
    await setup({ "tenbox.yaml": manifest({ notify: { ntfy: ntfy.url } }) });
  });
  afterEach(() => ntfy.stop());

  test("a new failure sends one line with the check, the count and the round", async () => {
    await writeOut(" FAIL  old\n FAIL  new\n");
    await runChecks(input());
    expect(ntfy.lines()).toEqual([
      "demo · T-1 · check-failed · unit: 1 new failure(s), round 1, the build goes on → tenbox attach T-1",
    ]);
  });

  test("a build.json means the build is over: the line does not say it goes on", async () => {
    await files.write(path.join(taskWorktree, ".tenbox", "build.json"), "{}");
    await writeOut(" FAIL  old\n FAIL  new\n");
    await runChecks(input());
    expect(ntfy.lines()).toEqual([
      "demo · T-1 · check-failed · unit: 1 new failure(s), round 1 → tenbox attach T-1",
    ]);
  });

  test("a check with no new failure sends nothing", async () => {
    await runChecks(input());
    expect(ntfy.lines()).toEqual([]);
  });
});
