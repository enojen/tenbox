import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;

let project: TempProject;
let proofsFile: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  const taskWorktree = path.join(project.wtRoot, "demo", "T-1");
  proofsFile = path.join(taskWorktree, ".tenbox", "proofs.json");
  await tenbox(["start", "T-1", "--title", "x", "--no-tmux"], project.mainDir);
  await files.write(path.join(taskWorktree, ".tenbox", "parts", "01-x.md"), "status: todo\n");
});

afterEach(async () => {
  await project.remove();
});

const proof = (...flags: string[]) => tenbox(["proof", "T-1", ...flags], project.mainDir);
const fullFlags = (test: string) => [
  ...["--part", "01", "--file", "a.test.ts"],
  ...["--test", test, "--failure", "got 1"],
];
const readProofs = async () => {
  const text = await files.read(proofsFile);
  return JSON.parse(text ?? "null");
};

describe("tenbox proof", () => {
  test("appends each proof to proofs.json", async () => {
    const first = await proof(...fullFlags("t one"));
    const second = await proof(...fullFlags("t two"));
    expect([first.code, first.json.ok, second.code]).toEqual([0, true, 0]);
    expect(first.json).toMatchObject({
      task: "T-1",
      file: proofsFile,
      proof: { part: "01", file: "a.test.ts", test: "t one", failure: "got 1" },
    });
    const written = await readProofs();
    expect(written.map((one: { test: string }) => one.test)).toEqual(["t one", "t two"]);
  });

  test("an invalid proofs.json is bad-proofs and stays as it is", async () => {
    await files.write(proofsFile, "{ not json");
    const run = await proof(...fullFlags("t"));
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-proofs"]);
    expect(run.json.error).toContain("proofs.json");
    const kept = await files.read(proofsFile);
    expect(kept).toBe("{ not json");
  });

  test.each([
    ["a value that is not an array", '{"part":"01"}'],
    ["an item with a blank field", '[{"part":"01","file":"a","test":"","failure":"x"}]'],
  ])("proofs.json with %s is bad-proofs and stays as it is", async (_name, text) => {
    await files.write(proofsFile, text);
    const run = await proof(...fullFlags("t"));
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "bad-proofs"]);
    expect(run.json.error).toContain("proofs.json");
    const kept = await files.read(proofsFile);
    expect(kept).toBe(text);
  });

  test("flags are stored trimmed, so padded and plain names are one test", async () => {
    const run = await proof(
      "--part",
      " 01 ",
      "--file",
      " a.test.ts",
      "--test",
      " t ",
      "--failure",
      " got 1 ",
    );
    expect(run.json.proof).toEqual({ part: "01", file: "a.test.ts", test: "t", failure: "got 1" });
  });

  test("a missing or blank flag is a usage error and writes nothing", async () => {
    const missing = await proof("--part", "01", "--file", "a.test.ts", "--test", "t");
    const blank = await proof(...fullFlags("   "));
    expect([missing.code, missing.json.code]).toEqual([USAGE_EXIT, "usage"]);
    expect([blank.code, blank.json.code]).toEqual([USAGE_EXIT, "usage"]);
    const written = await files.exists(proofsFile);
    expect(written).toBe(false);
  });

  test("a part without a part file is unknown-part and writes nothing", async () => {
    const run = await proof("--part", "09", "--file", "f", "--test", "t", "--failure", "x");
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "unknown-part"]);
    const written = await files.exists(proofsFile);
    expect(written).toBe(false);
  });
});
