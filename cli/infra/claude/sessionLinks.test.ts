import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureStderr } from "../../test/stderr.ts";
import { files } from "../files.ts";
import { sessionLinks } from "./sessionLinks.ts";

let root: string;
let cwd: string;

beforeEach(async () => {
  const made = await mkdtemp(path.join(os.tmpdir(), "tenbox-links-"));
  root = await realpath(made);
  cwd = path.join(root, "wt");
  await files.write(path.join(cwd, ".keep"), "");
  process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
});

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR;
  await rm(root, { recursive: true, force: true });
});

const session = (pid: number, fields: object) =>
  files.write(path.join(root, "claude", "sessions", `${pid}.json`), JSON.stringify(fields));

test("the newest startedAt of the cwd gives the link", async () => {
  await session(1, { cwd, startedAt: 1, bridgeSessionId: "session_A" });
  await session(2, { cwd, startedAt: 2, bridgeSessionId: "session_B" });
  const link = await sessionLinks.find(cwd);
  expect(link).toBe("https://claude.ai/code/session_B");
});

test("another cwd, no bridgeSessionId or no sessions dir gives null", async () => {
  const none = await sessionLinks.find(cwd);
  expect(none).toBeNull();
  await session(1, { cwd: root, startedAt: 5, bridgeSessionId: "session_X" });
  await session(2, { cwd, startedAt: 6 });
  const other = await sessionLinks.find(cwd);
  expect(other).toBeNull();
});

test("a session file that does not fit gives null and one warning", async () => {
  await session(1, { cwd, startedAt: "yesterday", bridgeSessionId: "session_A" });
  const file = path.join(root, "claude", "sessions", "1.json");
  const read = await captureStderr(() => sessionLinks.find(cwd));
  expect(read.value).toBeNull();
  expect(read.stderr).toStartWith(`warning: ${file}: startedAt: `);
});
