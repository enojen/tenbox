declare class TenboxError extends Error {
  readonly code: string;
}
declare function gitError(message: string): TenboxError;

export function samples(error: unknown): void {
  if (error instanceof TenboxError && error.code === "git") return;
  throw gitError("git failed");
}
