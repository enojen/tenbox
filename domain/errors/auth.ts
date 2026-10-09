import { TenboxError } from "./index.ts";

export function unauthorizedError(): TenboxError {
  return new TenboxError("a valid Authorization: Bearer <token> header is needed", "unauthorized");
}
