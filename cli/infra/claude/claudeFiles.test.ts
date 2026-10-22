import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { captureStderr } from "../../test/stderr.ts";
import { files } from "../files.ts";
import { claudeFiles } from "./claudeFiles.ts";

const Shape = z.object({ id: z.string() });

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tenbox-claude-files-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("find gives the value of a file that fits, and null with no warning for a missing one", async () => {
  const file = path.join(root, "a.json");
  await files.write(file, '{"id":"a","other":1}');
  const fits = await captureStderr(() => claudeFiles.find(Shape, file));
  const missing = await captureStderr(() => claudeFiles.find(Shape, path.join(root, "b.json")));
  expect(fits).toEqual({ value: { id: "a" }, stderr: "" });
  expect(missing).toEqual({ value: null, stderr: "" });
});

test("find gives null and one warning for a file that is not JSON or does not fit", async () => {
  const notJson = path.join(root, "a.json");
  const wrong = path.join(root, "b.json");
  await files.write(notJson, "{nope");
  await files.write(wrong, '{"id":1}');
  const first = await captureStderr(() => claudeFiles.find(Shape, notJson));
  const second = await captureStderr(() => claudeFiles.find(Shape, wrong));
  expect(first).toEqual({ value: null, stderr: `warning: ${notJson}: not JSON\n` });
  expect(second.value).toBeNull();
  expect(second.stderr).toStartWith(`warning: ${wrong}: id: `);
});

test("findLines gives the lines that fit and one warning with the count of the others", async () => {
  const file = path.join(root, "a.jsonl");
  await files.write(file, '{"id":"a"}\n{nope\n{"id":1}\n{"id":"b"}\n');
  const read = await captureStderr(() => claudeFiles.findLines(Shape, file));
  expect(read).toEqual({
    value: [{ id: "a" }, { id: "b" }],
    stderr: `warning: ${file}: 2 line(s) skipped\n`,
  });
});

test("findLines gives null with no warning for a missing file, and no warning when every line fits", async () => {
  const file = path.join(root, "a.jsonl");
  await files.write(file, '{"id":"a"}\n');
  const fits = await captureStderr(() => claudeFiles.findLines(Shape, file));
  const missing = await captureStderr(() =>
    claudeFiles.findLines(Shape, path.join(root, "b.jsonl")),
  );
  expect(fits).toEqual({ value: [{ id: "a" }], stderr: "" });
  expect(missing).toEqual({ value: null, stderr: "" });
});
