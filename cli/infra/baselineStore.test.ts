import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { failureLine } from "../../domain/failures.ts";
import { baselineStore } from "./baselineStore.ts";

const KEY = { project: "demo", check: "unit" };
const META = { date: "2026-01-01T00:00:00.000Z", cmd: "bun test", exit_code: 1 };
const OLDER_SECONDS = 1_000;
const NEWER_SECONDS = 2_000;
let root: string;
let previousDir: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tenbox-baselines-"));
  previousDir = process.env.WTBASE_DIR;
  process.env.WTBASE_DIR = root;
});

afterEach(async () => {
  if (previousDir === undefined) delete process.env.WTBASE_DIR;
  else process.env.WTBASE_DIR = previousDir;
  await rm(root, { recursive: true, force: true });
});

const touch = (sha: string, seconds: number) =>
  utimes(path.join(root, "demo", "unit", `${sha}.txt`), seconds, seconds);

describe("baselines", () => {
  test("save writes the wtbase layout and find reads it back", async () => {
    const lines = [failureLine("FAIL a"), failureLine("FAIL b")];
    await baselineStore.save(KEY, { sha: "abc", lines }, META);
    const found = await baselineStore.find(KEY, "abc");
    const text = await Bun.file(path.join(root, "demo", "unit", "abc.txt")).text();
    const meta = await Bun.file(path.join(root, "demo", "unit", "abc.meta")).text();
    expect(found).toEqual({ sha: "abc", lines });
    expect(text).toBe("FAIL a\nFAIL b\n");
    expect(meta).toBe("sha=abc\ndate=2026-01-01T00:00:00.000Z\ncmd=bun test\nexit_code=1\n");
  });
  test("an empty baseline is an empty file", async () => {
    await baselineStore.save(KEY, { sha: "e", lines: [] }, META);
    const found = await baselineStore.find(KEY, "e");
    expect(found).toEqual({ sha: "e", lines: [] });
  });
  test("find is null for an unknown sha and newest is null without baselines", async () => {
    const found = await baselineStore.find(KEY, "nope");
    const newest = await baselineStore.findNewest(KEY);
    expect(found).toBeNull();
    expect(newest).toBeNull();
  });
  test("newest picks the baseline with the latest mtime", async () => {
    await baselineStore.save(KEY, { sha: "new", lines: [failureLine("FAIL n")] }, META);
    await baselineStore.save(KEY, { sha: "old", lines: [] }, META);
    await touch("new", NEWER_SECONDS);
    await touch("old", OLDER_SECONDS);
    const newest = await baselineStore.findNewest(KEY);
    expect(newest).toEqual({ sha: "new", lines: [failureLine("FAIL n")] });
  });
});
