import { TenboxError } from "../../domain/errors/index.ts";
import { elapsedMs, hasErrorCode } from "../../domain/utils.ts";
import { env, log } from "./env.ts";
import { files } from "./files.ts";

export interface ProcessOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Variables set on top of the current environment. */
  env?: Record<string, string>;
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

/** Runs a program without a shell: Tenbox starts only git, tmux, gh, docker and claude. */
export const processes = { run, stopAll, which };

/** Path of a program in the current PATH; Bun.which alone reads the PATH from startup. */
function which(name: string): string | null {
  return Bun.which(name, { PATH: process.env.PATH });
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

async function start(
  cmd: string[],
  options: ProcessOptions,
): Promise<Bun.Subprocess<"ignore", "pipe", "pipe">> {
  try {
    return Bun.spawn(cmd, {
      cwd: options.cwd,
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
    if (!cwdIsDir) return new TenboxError(`directory ${cwd} does not exist`, "no-dir");
  }
  return new TenboxError(`${cmd[0]} not found in PATH`, "no-command");
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
