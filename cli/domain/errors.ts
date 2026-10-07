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
