import { setDefaultTimeout } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { parseObject } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

const MAIN_TS = path.join(import.meta.dir, "..", "main.ts");

/** A test that runs the real CLI starts git and bun processes. Alone it takes under 2 s; in a
 * build round, with every check and agent running at once, it passed bun's default 5 s. */
const CLI_TEST_TIMEOUT_MS = 30_000;
setDefaultTimeout(CLI_TEST_TIMEOUT_MS);

export type Json = Record<string, unknown>;

/** One run of the real CLI: exit code, raw output and the stdout JSON. */
export interface CliRun {
  code: number;
  out: string;
  err: string;
  json: Json;
}

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

/** One call of the fake `claude`: its working directory and its arguments. */
interface ClaudeCall {
  cwd: string;
  args: string[];
}

/** A background session as `claude agents --json` lists it. */
export interface FakeSession {
  id: string;
  cwd: string;
  kind: "background" | "interactive";
  startedAt: number;
  /** The `state` of a background session: working, blocked, done. */
  state?: string;
}

/**
 * A fake `claude` in `<root>/claude-bin`. It logs each call, answers `agents` with the sessions
 * set by `setSessions`, and fails with `failWith`'s text on stderr.
 */
export interface FakeClaude {
  /** The env that puts the fake first in `PATH`. */
  env: Record<string, string>;
  calls(): Promise<ClaudeCall[]>;
  setSessions(sessions: FakeSession[]): Promise<void>;
  failWith(stderr: string): Promise<void>;
}

const EXECUTABLE = 0o755;

export async function makeFakeClaude(root: string): Promise<FakeClaude> {
  const bin = path.join(root, "claude-bin");
  const callsFile = path.join(root, "claude.calls");
  const sessionsFile = path.join(root, "claude.sessions");
  const failFile = path.join(root, "claude.fail");
  const script = [
    "#!/bin/sh",
    `if [ -f "${failFile}" ]; then cat "${failFile}" >&2; exit 1; fi`,
    `printf '%s' "$PWD" >> "${callsFile}"`,
    `printf '\t%s' "$@" >> "${callsFile}"`,
    `printf '\n' >> "${callsFile}"`,
    `if [ "$1" = agents ]; then cat "${sessionsFile}" 2>/dev/null || echo '[]'; fi`,
    "",
  ].join("\n");
  await files.write(path.join(bin, "claude"), script);
  await chmod(path.join(bin, "claude"), EXECUTABLE);
  return {
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    calls: () => readCalls(callsFile),
    setSessions: (sessions) => files.write(sessionsFile, JSON.stringify(sessions)),
    failWith: (stderr) => files.write(failFile, stderr),
  };
}

async function readCalls(file: string): Promise<ClaudeCall[]> {
  const text = await files.read(file);
  const lines = (text ?? "").split("\n").filter((line) => line !== "");
  return lines.map((line) => {
    const [cwd = "", ...args] = line.split("\t");
    return { cwd, args };
  });
}
