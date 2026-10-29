import { setDefaultTimeout } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { jsons, objects } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";
import { bundledMain } from "./bundle.ts";
import { type CliOutput, inProcessBusy, runInProcess } from "./inProcess.ts";

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

/** One run of the CLI: its arguments, working directory, extra env and what it reads on stdin. */
interface CliInput {
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
}

/** Runs `tenbox <args>` with bun by full path, so tests may change `PATH`. */
export function tenbox(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<CliRun> {
  return tenboxInput({ args, cwd, env: extraEnv });
}

/**
 * Like `tenbox`, with text on stdin, as a Claude Code hook gets it. A run without stdin runs in
 * this process unless another one is running; else, and with stdin, it starts a process.
 */
export async function tenboxInput(input: CliInput): Promise<CliRun> {
  const { args, cwd, env = {}, stdin } = input;
  const inProcess = stdin === undefined && !inProcessBusy();
  const run = inProcess
    ? runInProcess({ args, cwd, env })
    : runInChild({ args, cwd, env, stdin: stdin ?? "" });
  const { code, out, err } = await run;
  const json = jsons.parse(out);
  if (!objects.isRecord(json))
    throw new Error(`stdout is not JSON (exit ${code}):\n${out}\n--- stderr:\n${err}`);
  return { code, out, err, json };
}

async function runInChild(input: Required<CliInput>): Promise<CliOutput> {
  const { args, cwd, env, stdin } = input;
  const main = await bundledMain();
  const proc = Bun.spawn([process.execPath, main, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

/** One call of the fake `claude`: its working directory and its arguments. */
interface ClaudeCall {
  cwd: string;
  args: string[];
}

/** The kind of a session `claude agents --json` lists. */
type FakeSessionKind = "background" | "interactive";

/** A background session as `claude agents --json` lists it. */
export interface FakeSession {
  id: string;
  cwd: string;
  kind: FakeSessionKind;
  startedAt: number;
  /** The `state` of a background session: working, blocked, done. */
  state?: string;
  /** The process; a session from an earlier boot is listed without one. */
  pid?: number;
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

const NotificationHooksSchema = z.object({
  Notification: z.array(
    z.object({
      matcher: z.string(),
      hooks: z.array(z.object({ type: z.string(), command: z.string() })),
    }),
  ),
});

type NotificationHooks = z.infer<typeof NotificationHooksSchema>;

const HookSettings = z.object({ hooks: NotificationHooksSchema });

/** The `Notification` hooks in the `--settings` JSON of a `claude` call; null without a valid one. */
export function notificationHooks(args: string[]): NotificationHooks | null {
  const at = args.indexOf("--settings");
  const result = jsons.check(HookSettings, args[at + 1] ?? "");
  return result.ok ? result.value.hooks : null;
}

async function readCalls(file: string): Promise<ClaudeCall[]> {
  const text = await files.read(file);
  const lines = (text ?? "").split("\n").filter((line) => line !== "");
  return lines.map((line) => {
    const [cwd = "", ...args] = line.split("\t");
    return { cwd, args };
  });
}
