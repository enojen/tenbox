import { TenboxError } from "./index.ts";

export function projectExistsError(id: string): TenboxError {
  return new TenboxError(`project "${id}" already exists`, "project-exists");
}

export function projectNotFoundError(id: string): TenboxError {
  return new TenboxError(`project "${id}" is not on the server`, "project-not-found");
}

export function trackerKeyError(id: string): TenboxError {
  return new TenboxError(
    `the tracker key of project "${id}" does not open with the server's encryption key`,
    "tracker-key",
  );
}
