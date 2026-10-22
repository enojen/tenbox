import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureStderr } from "../../test/stderr.ts";
import { files } from "../files.ts";
import { claudeCredentials } from "./credentials.ts";

const SECRET = "SECRET-TOKEN";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tenbox-credentials-"));
  process.env.CLAUDE_CONFIG_DIR = root;
});

afterEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR;
  await rm(root, { recursive: true, force: true });
});

const writeCredentials = (fields: object) =>
  files.write(path.join(root, ".credentials.json"), JSON.stringify(fields));

test("the refresh expiry is read; a file with no claude.ai login gives null with no warning", async () => {
  await writeCredentials({ claudeAiOauth: { accessToken: SECRET, refreshTokenExpiresAt: 5 } });
  const expiry = await claudeCredentials.findRefreshExpiry();
  await writeCredentials({ mcpOAuth: { token: SECRET } });
  const none = await captureStderr(() => claudeCredentials.findRefreshExpiry());
  expect(expiry).toBe(5);
  expect(none).toEqual({ value: null, stderr: "" });
});

test("a refresh expiry that is not a number gives null and one warning without the token", async () => {
  await writeCredentials({ claudeAiOauth: { accessToken: SECRET, refreshTokenExpiresAt: SECRET } });
  const read = await captureStderr(() => claudeCredentials.findRefreshExpiry());
  expect(read.value).toBeNull();
  expect(read.stderr).toStartWith(
    `warning: ${claudeCredentials.file()}: claudeAiOauth.refreshTokenExpiresAt: `,
  );
  expect(read.stderr).not.toContain(SECRET);
});
