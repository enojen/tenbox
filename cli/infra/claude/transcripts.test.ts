import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureStderr } from "../../test/stderr.ts";
import { files } from "../files.ts";
import { readTranscript } from "./transcripts.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tenbox-transcripts-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const usage = { input_tokens: 1, output_tokens: 2 };

test("lines of other types are passed by; a broken assistant line or a non-JSON line gives one warning", async () => {
  const file = path.join(root, "agent-a1.jsonl");
  const lines = [
    { type: "user", timestamp: "2026-01-01T00:00:00.000Z", message: { content: "x" } },
    { type: "attachment" },
    { type: "assistant", message: { id: "m1" } },
    { type: "assistant", timestamp: "2026-01-01T00:01:00.000Z", message: { id: "m2", usage } },
  ].map((line) => JSON.stringify(line));
  await files.write(file, `${[...lines, "{nope"].join("\n")}\n`);
  const read = await captureStderr(() => readTranscript(file));
  expect(read.value).toEqual({
    usage: { calls: 1, input: 1, output: 2, cache_write: 0, cache_read: 0 },
    model: null,
    firstAt: "2026-01-01T00:00:00.000Z",
    lastAt: "2026-01-01T00:01:00.000Z",
  });
  expect(read.stderr).toBe(`warning: ${file}: 2 line(s) skipped\n`);
});
