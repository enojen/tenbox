/** Every failure the CLI reports. `code` is a short machine-readable slug. */
export class TenboxError extends Error {
  constructor(
    message: string,
    readonly code: string = "error",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "TenboxError";
  }
}

/** The base branch of a task is missing or unrelated to its HEAD. */
export function noBaseError(base: string, reason: string): TenboxError {
  return new TenboxError(`base ${base} ${reason}; pass --base <branch>`, "no-base");
}
