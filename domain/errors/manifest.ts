import { TenboxError } from "./index.ts";

export function manifestError(message: string, details?: unknown): TenboxError {
  return new TenboxError(message, "manifest", details);
}

export function envError(name: string, raw: string, expected: string): TenboxError {
  return new TenboxError(`${name} "${raw}": ${expected}`, "env");
}

export function noChecksError(): TenboxError {
  return new TenboxError("no checks: in tenbox.yaml; add one", "no-checks");
}

export function manifestNotCommittedError(base: string): TenboxError {
  return new TenboxError(
    `tenbox.yaml is not committed on ${base}, or has local changes: commit tenbox.yaml on ${base}, then start again`,
    "manifest-not-committed",
  );
}
