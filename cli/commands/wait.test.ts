import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const WRITE_DELAY_MS = 300;

let project: TempProject;
let tenboxDir: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  tenboxDir = path.join(project.wtRoot, "demo", "T-1", ".tenbox");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
});

afterEach(async () => {
  await project.remove();
});

const rounds = (): string => path.join(tenboxDir, "rounds");
const wait = (...args: string[]) => tenbox(["wait", "T-1", ...args], project.mainDir);

describe("tenbox wait", () => {
  test.each(["plan", "build"])("returns at once when %s.json exists", async (kind) => {
    const file = path.join(tenboxDir, `${kind}.json`);
    await files.write(file, "{}");
    const run = await wait("--for", kind);
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", file }]);
  });

  test("returns after the file appears", async () => {
    const file = path.join(tenboxDir, "build.json");
    setTimeout(() => files.write(file, "{}"), WRITE_DELAY_MS);
    const run = await wait("--for", "build", "--timeout", "10");
    expect([run.code, run.json]).toEqual([0, { ok: true, task: "T-1", file }]);
  });

  test("fails with wait-timeout when the file never appears", async () => {
    const run = await wait("--for", "build", "--timeout", "1");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "wait-timeout"]);
  });

  test.each([[[]], [["--for", "close"]]])("--for %p is a usage error", async (args) => {
    const run = await wait(...args);
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
  });

  describe("--for round", () => {
    const checks = (n: number) => path.join(rounds(), String(n), "checks.json");

    test("returns running with the file of a new rounds/N/checks.json", async () => {
      await files.write(checks(1), "{}");
      setTimeout(() => files.write(checks(2), "{}"), WRITE_DELAY_MS);
      const run = await wait("--for", "round", "--timeout", "10");
      expect([run.code, run.json]).toEqual([
        0,
        { ok: true, task: "T-1", round: 2, status: "running", file: checks(2) },
      ]);
    });

    test("an earlier checks.json does not end the wait", async () => {
      await files.write(checks(1), "{}");
      const run = await wait("--for", "round", "--timeout", "1");
      expect([run.code, run.json.code]).toEqual([1, "wait-timeout"]);
    });

    test("returns the build.json status when build.json is written", async () => {
      const file = path.join(tenboxDir, "build.json");
      const result = {
        status: "failed",
        round: 3,
        proofs: [],
        attention: [],
        nice_to_have: [],
        unproven: [],
      };
      setTimeout(() => files.write(file, JSON.stringify(result)), WRITE_DELAY_MS);
      const run = await wait("--for", "round", "--timeout", "10");
      expect([run.code, run.json]).toEqual([
        0,
        { ok: true, task: "T-1", round: 3, status: "failed", file },
      ]);
    });

    test("returns when an existing build.json changes", async () => {
      const file = path.join(tenboxDir, "build.json");
      const result = { round: 1, proofs: [], attention: [], nice_to_have: [], unproven: [] };
      await files.write(file, JSON.stringify({ ...result, status: "needs-you" }));
      const next = JSON.stringify({ ...result, status: "ready-for-you", round: 2 });
      setTimeout(() => files.write(file, next), WRITE_DELAY_MS);
      const run = await wait("--for", "round", "--timeout", "10");
      expect([run.json.status, run.json.round]).toEqual(["ready-for-you", 2]);
    });
  });
});
