import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { files } from "./files.ts";

let project: TempProject;

beforeEach(async () => {
  project = await makeTempProject({ "a.txt": "a\n" });
});

afterEach(async () => {
  await project.remove();
});

test("missing paths are false, [] and null", async () => {
  const missing = path.join(project.root, "nope", "deeper");
  const belowFile = path.join(project.mainDir, "a.txt", "below");
  const exists = await files.exists(missing);
  expect(exists).toBe(false);
  const isDir = await files.isDir(missing);
  expect(isDir).toBe(false);
  const list = await files.list(missing);
  expect(list).toEqual([]);
  const link = await files.readLink(missing);
  expect(link).toBeNull();
  const belowExists = await files.exists(belowFile);
  expect(belowExists).toBe(false);
});

test("permission errors are rethrown", async () => {
  const locked = path.join(project.root, "locked");
  const inner = path.join(locked, "inner.txt");
  await files.write(inner, "x");
  await chmod(locked, 0o000);
  try {
    await expect(files.exists(inner)).rejects.toThrow("EACCES");
    await expect(files.isDir(inner)).rejects.toThrow("EACCES");
    await expect(files.readLink(inner)).rejects.toThrow("EACCES");
    await expect(files.list(locked)).rejects.toThrow("EACCES");
  } finally {
    await chmod(locked, 0o755);
  }
});

test("write replaces the file and leaves no tmp file", async () => {
  const target = path.join(project.root, "out", "f.txt");
  await files.write(target, "one");
  await files.write(target, "two");
  const text = await files.read(target);
  expect(text).toBe("two");
  const names = await files.list(path.dirname(target));
  expect(names).toEqual(["f.txt"]);
});
