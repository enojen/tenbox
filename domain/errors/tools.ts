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
