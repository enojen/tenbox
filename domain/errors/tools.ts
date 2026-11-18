import { TenboxError } from "./index.ts";

export function ghError(subcommand: string, reason: string): TenboxError {
  return new TenboxError(`gh ${subcommand} failed: ${reason}`, "gh");
}

export function ghNoPrError(branch: string): TenboxError {
  return new TenboxError(`no open PR for ${branch} after gh ran`, "gh");
}

export function claudeError(subcommand: string, reason: string): TenboxError {
  return new TenboxError(`claude ${subcommand} failed: ${reason}`, "claude");
}

export function noCommandError(command: string | undefined): TenboxError {
  return new TenboxError(`${command} not found in PATH`, "no-command");
}

export function noDirError(dir: string): TenboxError {
  return new TenboxError(`directory ${dir} does not exist`, "no-dir");
}

export function settingsError(file: string, reason: string): TenboxError {
  return new TenboxError(`${file}: ${reason}`, "settings");
}

/** A remote service answered wrongly; `code` is the service's error code. */
export function serviceError(
  service: string,
  code: string,
  message: string,
  details?: unknown,
): TenboxError {
  return new TenboxError(`${service}: ${message}`, code, details);
}

export function trackerError(message: string): TenboxError {
  return new TenboxError(message, "tracker");
}

/** The tracker has no lists or parent tasks for `tenbox task new --list` or `--parent`. */
export function trackerUnsupportedError(tracker: string): TenboxError {
  return new TenboxError(
    `${tracker} has no list or parent for a new task; run tenbox task new without --list and --parent`,
    "tracker-unsupported",
  );
}

export function trackerAuthError(message: string): TenboxError {
  return new TenboxError(message, "tracker-auth");
}

export function noTrackerError(id: string): TenboxError {
  return new TenboxError(
    `no tracker configured for ${id}; pass --title "..." or add tracker: to tenbox.yaml`,
    "no-tracker",
  );
}

export function noTrackerToWriteError(): TenboxError {
  return new TenboxError(
    "no tracker configured; add tracker: to tenbox.yaml, or use tenbox report for a Tenbox task",
    "no-tracker",
  );
}

export function noLoginError(file: string): TenboxError {
  return new TenboxError(
    `no claude.ai login at ${file}; run /login in claude on this computer`,
    "no-login",
  );
}

export function loginExpiredError(expiry: Date): TenboxError {
  return new TenboxError(
    `the claude.ai login expired at ${expiry.toISOString()}; run /login in claude on this computer`,
    "login-expired",
  );
}

export function noProjectIdError(mainDir: string): TenboxError {
  return new TenboxError(
    `no project id in ${mainDir}/tenbox.yaml; run tenbox start once and commit tenbox.yaml`,
    "no-project-id",
  );
}

export function noMachineRunError(task: string): TenboxError {
  return new TenboxError(
    `task ${task} has no run; start one with tenbox machine run`,
    "no-machine-run",
  );
}

export function machineBusyError(task: string, runs: string[]): TenboxError {
  return new TenboxError(
    `task ${task} still runs on the cluster: ${runs.join(", ")}; wait until it ends`,
    "machine-busy",
  );
}

/** `details` is the result of the run: its phase, reason, exit code and output. */
export function machineFailedError(run: string, details: unknown): TenboxError {
  return new TenboxError(`run ${run} failed on the cluster`, "machine-failed", details);
}

export function machineTimeoutError(task: string, runs: string[]): TenboxError {
  return new TenboxError(
    `task ${task} still runs on the cluster after the timeout: ${runs.join(", ")}; it keeps running`,
    "machine-timeout",
  );
}

export function noTenportError(): TenboxError {
  return new TenboxError(
    "no Tenport for the machine runs; set TENPORT_URL and TENPORT_TOKEN",
    "no-tenport",
  );
}

/** A box that waits for something that does not come by itself, such as a missing Secret. */
export function boxNotStartedError(run: string, reason: string): TenboxError {
  return new TenboxError(`the box of run ${run} cannot start: ${reason}`, "box-not-started");
}

/** Tenport keeps the run, but its Job and its log are gone. */
export function logGoneError(run: string): TenboxError {
  return new TenboxError(`the log of run ${run} is gone with its Job`, "job-gone");
}
