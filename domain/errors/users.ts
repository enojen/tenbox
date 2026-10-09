import { TenboxError } from "./index.ts";

export function userExistsError(github: string): TenboxError {
  return new TenboxError(`user "${github}" already exists`, "user-exists");
}
