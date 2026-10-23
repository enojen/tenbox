import { TenboxError } from "./index.ts";

/* Errors of a task's place and run: its worktree, setup, background session, wait. */

export function noWorktreeError(id: string): TenboxError {
  return new TenboxError(`no worktree for ${id}; run: tenbox start ${id}`, "no-worktree");
}

export function noSessionError(id: string): TenboxError {
  return new TenboxError(`${id} has no background session; run: tenbox build ${id}`, "no-session");
}

export function sessionBusyError(id: string): TenboxError {
  return new TenboxError(
    `${id} has a busy background session; run: tenbox attach ${id}`,
    "session-busy",
  );
}

export function setupError(exitCode: number, cmd: string, output: string): TenboxError {
  return new TenboxError(`setup failed (exit ${exitCode}): ${cmd}`, "setup", { output });
}

export function waitTimeoutError(file: string, seconds: number): TenboxError {
  return new TenboxError(`${file} did not appear within ${seconds} seconds`, "wait-timeout");
}

export function noRunError(id: string): TenboxError {
  return new TenboxError(
    `${id} has no tenbox-build run in the Claude Code session files; run: tenbox build ${id}`,
    "no-run",
  );
}
