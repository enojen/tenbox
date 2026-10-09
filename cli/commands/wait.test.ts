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
  await tenbox(["start", "T-1", "--title", "x", "--no-tmux"], project.mainDir);
});

afterEach(async () => {
  await project.remove();
});

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
});
