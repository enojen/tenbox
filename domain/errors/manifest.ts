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
