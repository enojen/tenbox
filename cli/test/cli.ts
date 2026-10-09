import { test } from "bun:test";
import path from "node:path";
import { parseObject } from "../../domain/utils.ts";

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

/** Runs `tmux <args>` against the env of the test process, so it reaches the project's own server. */
export function tmux(args: string[]): { exitCode: number } {
  return Bun.spawnSync(["tmux", ...args], { env: process.env });
}
