import { TenboxError } from "./index.ts";

export function projectExistsError(id: string): TenboxError {
  return new TenboxError(`project "${id}" already exists`, "project-exists");
}
