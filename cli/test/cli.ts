import { test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { parseObject } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

const MAIN_TS = path.join(import.meta.dir, "..", "main.ts");

export type Json = Record<string, unknown>;

/** One run of the real CLI: exit code, raw output and the stdout JSON. */
export interface CliRun {
  code: number;
  out: string;
  err: string;
  json: Json;
}

/** Runs only where tmux is installed. */
export const hasTmux = Bun.which("tmux") !== null;
export const tmuxTest = hasTmux ? test : test.skip;

/** Runs `tenbox <args>` with bun by full path, so tests may change `PATH`. */
export async function tenbox(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<CliRun> {
  const proc = Bun.spawn([process.execPath, "run", MAIN_TS, ...args], {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const json = parseObject(out);
  if (!json) throw new Error(`stdout is not JSON (exit ${code}):\n${out}\n--- stderr:\n${err}`);
  return { code, out, err, json };
}

export interface TmuxRun {
  exitCode: number;
  stdout: string;
}

/** Runs `tmux <args>` on `server` (a task's `TMUX_TMPDIR`), or without one on the test's own server. */
export function tmux(args: string[], server: string | null = null): TmuxRun {
  const extra = server === null ? {} : { TMUX_TMPDIR: server, TMUX: "" };
  const result = Bun.spawnSync(["tmux", ...args], { env: { ...process.env, ...extra } });
  return { exitCode: result.exitCode, stdout: result.stdout.toString().trim() };
}

/** Kills every task tmux server in the list, removes its dir and empties the list. */
export async function removeServers(servers: string[]): Promise<void> {
  for (const server of servers.splice(0)) {
    tmux(["kill-server"], server);
    await rm(server, { recursive: true, force: true });
  }
}

const POLL_MS = 50;
const WAIT_MS = 5000;

/** The file's text once it has some; "" after five seconds. */
export async function waitForText(file: string): Promise<string> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const text = await files.read(file);
    if (text) return text;
    await Bun.sleep(POLL_MS);
  }
  return "";
}
