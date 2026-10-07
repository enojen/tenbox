/** End to end: the real CLI against a throwaway repo under a temp `~/wt`. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAIN_TS = path.join(import.meta.dir, "..", "main.ts");
let root: string;
let wt: string;
let main: string;
let env: Record<string, string>;

async function spawn(cmd: string[], cwd: string) {
  const p = Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

async function tenbox(args: string[], cwd: string) {
  const r = await spawn(["bun", "run", MAIN_TS, ...args], cwd);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(r.out) as Record<string, unknown>;
  } catch {
    throw new Error(`stdout is not JSON (exit ${r.code}):\n${r.out}\n--- stderr:\n${r.err}`);
  }
  return { ...r, json };
}

const git = (args: string[], cwd: string) => spawn(["git", ...args], cwd);

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tenbox-e2e-"));
  wt = path.join(root, "wt");
  main = path.join(wt, "demo", "main");
  env = {
    ...(process.env as Record<string, string>),
    TENBOX_WT_ROOT: wt,
    WTBASE_DIR: path.join(root, "baselines"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  await Bun.write(path.join(main, "check.sh"), "echo ' FAIL  old.test.ts > legacy'\nexit 1\n");
  await Bun.write(path.join(main, "tenbox.yaml"), "project: demo\nsetup: echo installed > .setup-ran\nchecks:\n  unit: sh ./check.sh\n  ok: echo fine\n");
  await git(["init", "-q", "-b", "main"], main);
  await git(["add", "."], main);
  await git(["commit", "-q", "-m", "init"], main);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("tenbox start", () => {
  test("creates worktree, branch, .tenbox/task.md, excludes, settings, runs setup", async () => {
    const r = await tenbox(["start", "T-1", "--title", "First task", "--no-tmux"], main);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, created: true, branch: "feat/T-1", setup: { state: "ran", cmd: "echo installed > .setup-ran" } });
    const dir = r.json.worktree as string;
    expect(dir).toBe(path.join(wt, "demo", "T-1"));
    expect((await git(["rev-parse", "--abbrev-ref", "HEAD"], dir)).out.trim()).toBe("feat/T-1");
    expect(await Bun.file(path.join(dir, ".tenbox", "task.md")).text()).toContain("# T-1 · First task");
    expect(await Bun.file(path.join(dir, ".setup-ran")).exists()).toBe(true);
    expect(await Bun.file(path.join(main, ".git", "info", "exclude")).text()).toContain(".tenbox/");
    expect(JSON.parse(await Bun.file(path.join(main, ".claude", "settings.local.json")).text())).toEqual({ worktree: { baseRef: "head" } });
    expect((await git(["status", "--porcelain"], dir)).out.trim()).toBe("?? .setup-ran");
  });
  test("is idempotent", async () => {
    const r = await tenbox(["start", "T-1", "--title", "First task", "--no-tmux", "--no-setup"], main);
    expect(r.json).toMatchObject({ ok: true, created: false, setup: { state: "skipped" } });
  });
  test("needs --title without a tracker", async () => {
    const r = await tenbox(["start", "T-2", "--no-tmux"], main);
    expect(r.code).toBe(1);
    expect(r.json).toMatchObject({ ok: false, code: "no-tracker" });
  });
  test("unknown flags are a usage error with exit 2", async () => {
    const r = await tenbox(["start", "T-3", "--bogus"], main);
    expect(r.code).toBe(2);
    expect(r.json).toMatchObject({ ok: false, code: "usage" });
  });
});

describe("tenbox check", () => {
  test("round 1: baseline from main, old failure is not new", async () => {
    const dir = path.join(wt, "demo", "T-1");
    const r = await tenbox(["check", "T-1"], dir);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, round: 1 });
    const unit = (r.json.checks as { name: string; failures: number; new_failures: string[]; baseline: { source: string } }[]).find((c) => c.name === "unit")!;
    expect(unit).toMatchObject({ failures: 1, new_failures: [], baseline: { source: "main" } });
    expect(await Bun.file(path.join(dir, ".tenbox", "rounds", "1", "checks.json")).exists()).toBe(true);
  });
  test("round 2: a new failure line fails the check; the exact baseline is reused", async () => {
    const dir = path.join(wt, "demo", "T-1");
    await Bun.write(path.join(dir, "check.sh"), "echo ' FAIL  old.test.ts > legacy'\necho ' FAIL  new.test.ts > cancel'\nexit 1\n");
    const r = await tenbox(["check", "T-1"], dir);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: false, round: 2 });
    const unit = (r.json.checks as { name: string; new_failures: string[]; baseline: { source: string } }[]).find((c) => c.name === "unit")!;
    expect(unit).toMatchObject({ new_failures: ["FAIL  new.test.ts > cancel"], baseline: { source: "exact" } });
    expect(r.json.summary).toContain("unit: 1 new failure");
  });
  test("resolves the worktree from the main checkout too", async () => {
    const r = await tenbox(["check", "T-1", "--round", "3"], main);
    expect(r.json).toMatchObject({ worktree: path.join(wt, "demo", "T-1"), round: 3 });
  });
});
