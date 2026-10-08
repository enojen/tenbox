/** End to end: the real CLI against a throwaway repo under a temp `~/wt`. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { type TempProject, makeTempProject } from "./tempProject.ts";

const MAIN_TS = path.join(import.meta.dir, "..", "main.ts");
let project: TempProject;
let wt: string;
let main: string;

async function spawn(cmd: string[], cwd: string) {
  const p = Bun.spawn(cmd, { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, out, err };
}

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): Json | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJson(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function tenbox(args: string[], cwd: string) {
  const r = await spawn(["bun", "run", MAIN_TS, ...args], cwd);
  const json = parseJson(r.out);
  if (!json) {
    throw new Error(`stdout is not JSON (exit ${r.code}):\n${r.out}\n--- stderr:\n${r.err}`);
  }
  return { ...r, json };
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
  const r = await spawn(["git", ...args], cwd);
  return r.out.trim();
}

const branchOf = (cwd: string) => gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
const statusOf = (cwd: string) => gitOutput(["status", "--porcelain"], cwd);

const unitCheck = (json: Json) => {
  const checks = Array.isArray(json.checks) ? json.checks : [];
  return checks.find((c) => isJson(c) && c.name === "unit");
};

beforeAll(async () => {
  project = await makeTempProject({
    "check.sh": "echo ' FAIL  old.test.ts > legacy'\nexit 1\n",
    "tenbox.yaml":
      "project: demo\nsetup: echo installed > .setup-ran\nchecks:\n  unit: sh ./check.sh\n  ok: echo fine\n",
  });
  wt = project.wtRoot;
  main = project.mainDir;
});

afterAll(async () => {
  await project.remove();
});

describe("tenbox start", () => {
  test("creates worktree, branch, .tenbox/task.md, excludes, settings, runs setup", async () => {
    const r = await tenbox(["start", "T-1", "--title", "First task", "--no-tmux"], main);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({
      ok: true,
      created: true,
      branch: "feat/T-1",
      setup: { state: "ran", cmd: "echo installed > .setup-ran" },
    });
    const dir = path.join(wt, "demo", "T-1");
    expect(r.json.worktree).toBe(dir);
    const branch = await branchOf(dir);
    const taskMd = await Bun.file(path.join(dir, ".tenbox", "task.md")).text();
    const setupRan = await Bun.file(path.join(dir, ".setup-ran")).exists();
    const exclude = await Bun.file(path.join(main, ".git", "info", "exclude")).text();
    const settings = await Bun.file(path.join(main, ".claude", "settings.local.json")).text();
    const status = await statusOf(dir);
    expect(branch).toBe("feat/T-1");
    expect(taskMd).toContain("# T-1 · First task");
    expect(setupRan).toBe(true);
    expect(exclude).toContain(".tenbox/");
    expect(JSON.parse(settings)).toEqual({ worktree: { baseRef: "head" } });
    expect(status).toBe("?? .setup-ran");
  });
  test("is idempotent", async () => {
    const r = await tenbox(
      ["start", "T-1", "--title", "First task", "--no-tmux", "--no-setup"],
      main,
    );
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
    const unit = unitCheck(r.json);
    expect(unit).toMatchObject({ failures: 1, new_failures: [], baseline: { source: "main" } });
    const written = await Bun.file(
      path.join(dir, ".tenbox", "rounds", "1", "checks.json"),
    ).exists();
    expect(written).toBe(true);
  });
  test("round 2: a new failure line fails the check; the exact baseline is reused", async () => {
    const dir = path.join(wt, "demo", "T-1");
    await Bun.write(
      path.join(dir, "check.sh"),
      "echo ' FAIL  old.test.ts > legacy'\necho ' FAIL  new.test.ts > cancel'\nexit 1\n",
    );
    const r = await tenbox(["check", "T-1"], dir);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: false, round: 2 });
    const unit = unitCheck(r.json);
    expect(unit).toMatchObject({
      new_failures: ["FAIL  new.test.ts > cancel"],
      baseline: { source: "exact" },
    });
    expect(r.json.summary).toContain("unit: 1 new failure");
  });
  test("resolves the worktree from the main checkout too", async () => {
    const r = await tenbox(["check", "T-1", "--round", "3"], main);
    expect(r.json).toMatchObject({ worktree: path.join(wt, "demo", "T-1"), round: 3 });
  });
});
