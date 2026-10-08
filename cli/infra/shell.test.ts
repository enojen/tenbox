import { expect, test } from "bun:test";
import { shell } from "./shell.ts";

const TIMEOUT_MS = 300;
const SLOW_COMMAND_SECONDS = 5;
const MAX_WAIT_MS = 2_000;

test("a timeout ends the command and its children", async () => {
  const started = performance.now();
  const command = `sleep ${SLOW_COMMAND_SECONDS}; echo done`;
  const result = await shell.run(command, { cwd: process.cwd(), timeoutMs: TIMEOUT_MS });
  const waitedMs = performance.now() - started;
  expect(result.timedOut).toBe(true);
  expect(result.output).not.toContain("done");
  expect(waitedMs).toBeLessThan(MAX_WAIT_MS);
});
