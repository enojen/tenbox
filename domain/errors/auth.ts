import { TenboxError } from "./index.ts";

export function unauthorizedError(): TenboxError {
  return new TenboxError("a valid Authorization: Bearer <token> header is needed", "unauthorized");
}

export function forbiddenError(what: string): TenboxError {
  return new TenboxError(`${what} is only for an admin of an organization`, "forbidden");
}
