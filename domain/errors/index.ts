import type { z } from "zod";

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

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** One line per zod issue, `path: message`; `(root)` for the value itself. */
export const issueLines = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

/** The state of a step that threw and did not stop the command. */
export type FailedState = `failed: ${string}`;

export const failedState = (e: unknown): FailedState => `failed: ${errorMessage(e)}`;
