import { closeSync, openSync } from "node:fs";
import type { TenboxError } from "../../domain/errors/index.ts";
import { noCommandError, noDirError } from "../../domain/errors/tools.ts";
import { elapsedMs } from "./clock.ts";
import { env, log } from "./env.ts";
import { files } from "./files.ts";
import { hasErrorCode } from "./nodeErrors.ts";

interface ProcessOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Variables set on top of the current environment. */
  env?: Record<string, string>;
}

/** A tenbox run that outlives this one; its stdout and stderr are appended to `logFile`. */
interface SelfRun {
  args: string[];
  cwd: string;
  logFile: string;
}

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const ENOENT = "ENOENT";

/** Process groups still running, so `stopAll` can end them when tenbox itself is stopped. */
const running = new Set<number>();

/** Runs a program without a shell: Tenbox starts only git, gh, docker, claude and itself. */
export const processes = { run, runInTerminal, runSelf, selfCommand, stopAll, which };

/** Path of a program in the current PATH; Bun.which alone reads the PATH from startup. */
function which(name: string): string | null {
  const path = process.env.PATH;
  if (path === undefined) return Bun.which(name);
  return Bun.which(name, { PATH: path });
}

async function run(cmd: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  const started = performance.now();
  const proc = await start(cmd, options);
  running.add(proc.pid);
  let timedOut = false;
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        killGroup(proc.pid);
      }, options.timeoutMs)
    : undefined;
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (env().debug) logRun(cmd, options, code, elapsedMs(started));
    return { code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
    running.delete(proc.pid);
  }
}

/** Hands the terminal to the program until it exits; returns its exit code. */
async function runInTerminal(cmd: string[], options: ProcessOptions = {}): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  return code;
}

/** The command line that runs `tenbox <args>` with the same runtime and entry file as this run. */
function selfCommand(args: string[]): string[] {
  return [process.execPath, Bun.main, ...args];
}

/** Starts `tenbox <args>` in its own process group and does not wait: it outlives this run. */
function runSelf(self: SelfRun): void {
  const log = openSync(self.logFile, "a");
  try {
    const proc = Bun.spawn(selfCommand(self.args), {
      cwd: self.cwd,
      env: process.env,
      stdio: ["ignore", log, log],
      detached: true,
    });
    proc.unref();
  } finally {
    closeSync(log);
  }
}

async function start(
  cmd: string[],
  options: ProcessOptions,
): Promise<Bun.Subprocess<"ignore", "pipe", "pipe">> {
  try {
    return Bun.spawn(cmd, {
      cwd: options.cwd ?? process.cwd(),
      // Bun.spawn defaults to the env at startup; tests change process.env later.
      env: { ...process.env, ...options.env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      // Its own process group: a timeout must also end the command's children, which keep
      // the output pipes open otherwise.
      detached: true,
    });
  } catch (e) {
    if (!hasErrorCode(e, [ENOENT])) throw e;
    const error = await missingError(cmd, options.cwd);
    throw error;
  }
}

/** Bun.spawn reports ENOENT for a missing binary and for a missing cwd alike. */
async function missingError(cmd: string[], cwd: string | undefined): Promise<TenboxError> {
  if (cwd !== undefined) {
    const cwdIsDir = await files.isDir(cwd);
    if (!cwdIsDir) return noDirError(cwd);
  }
  return noCommandError(cmd[0]);
}

function logRun(cmd: string[], options: ProcessOptions, code: number, ms: number): void {
  log(
    `tenbox: run ${cmd.join(" ")} (cwd ${options.cwd ?? process.cwd()}) exit ${code} in ${ms} ms`,
  );
}

/** Ends every running command with its children; detached groups miss the terminal's Ctrl-C. */
function stopAll(): void {
  for (const pid of running) killGroup(pid);
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group has already exited.
  }
}
