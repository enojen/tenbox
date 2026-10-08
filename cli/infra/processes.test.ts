import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { processes } from "./processes.ts";

const LONG_SLEEP_SECONDS = 30;
const POLL_MS = 20;
const MAX_WAIT_MS = 5_000;

async function readPid(file: string): Promise<number> {
  const deadline = performance.now() + MAX_WAIT_MS;
  while (performance.now() < deadline) {
    const text = await Bun.file(file)
      .text()
      .catch(() => "");
    if (text.trim()) return Number(text);
    await Bun.sleep(POLL_MS);
  }
  throw new Error("child did not write its pid");
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Killed children stay in the group until init reaps them, so poll. */
async function groupGone(pid: number): Promise<boolean> {
  const deadline = performance.now() + MAX_WAIT_MS;
  while (performance.now() < deadline) {
    if (!groupExists(pid)) return true;
    await Bun.sleep(POLL_MS);
  }
  return false;
}

test("stopAll ends a running process group with its children", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tenbox-processes-"));
  try {
    const pidFile = path.join(dir, "pid");
    const script = `sleep ${LONG_SLEEP_SECONDS} & echo $$ > ${pidFile}; wait`;
    const running = processes.run(["sh", "-c", script]);
    const pid = await readPid(pidFile);
    expect(groupExists(pid)).toBe(true);
    processes.stopAll();
    await running;
    const gone = await groupGone(pid);
    expect(gone).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing cwd is no-dir and a missing binary is no-command", async () => {
  const missing = path.join(os.tmpdir(), "tenbox-no-such-dir");
  const message = `directory ${missing} does not exist`;
  await expect(processes.run(["git", "status"], { cwd: missing })).rejects.toMatchObject({
    code: "no-dir",
    message,
  });
  await expect(processes.run(["tenbox-no-such-command"])).rejects.toMatchObject({
    code: "no-command",
  });
});
