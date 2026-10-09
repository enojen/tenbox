import { TenboxError } from "./index.ts";

/** The command line or an id is wrong. */
export function usageError(message: string): TenboxError {
  return new TenboxError(message, "usage");
}
