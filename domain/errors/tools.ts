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
export function serviceError(service: string, code: string, message: string): TenboxError {
  return new TenboxError(`${service}: ${message}`, code);
}

export function trackerError(message: string): TenboxError {
  return new TenboxError(message, "tracker");
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

export function noKubeconfigError(file: string): TenboxError {
  return new TenboxError(
    `no kubeconfig at ${file}; set KUBECONFIG or write ~/.kube/config`,
    "no-kubeconfig",
  );
}

/** `reason` names the missing field, never a value: the file holds the cluster credentials. */
export function kubeconfigError(file: string, reason: string): TenboxError {
  return new TenboxError(`kubeconfig ${file}: ${reason}`, "kubeconfig");
}

export function templateError(file: string, reason: string): TenboxError {
  return new TenboxError(`machine template ${file}: ${reason}`, "template");
}

export function noProjectIdError(mainDir: string): TenboxError {
  return new TenboxError(
    `no project id in ${mainDir}/tenbox.yaml; run tenbox start once and commit tenbox.yaml`,
    "no-project-id",
  );
}

export function noMachineRunError(task: string): TenboxError {
  return new TenboxError(
    `task ${task} has no Job on the cluster; start one with tenbox machine run`,
    "no-machine-run",
  );
}

export function machineBusyError(task: string, jobs: string[]): TenboxError {
  return new TenboxError(
    `task ${task} still runs on the cluster: ${jobs.join(", ")}; wait until it ends`,
    "machine-busy",
  );
}
