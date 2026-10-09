import { TenboxError } from "./index.ts";

export function gitFailedError(args: string[], reason: string): TenboxError {
  return new TenboxError(`git ${args.join(" ")} failed: ${reason}`, "git");
}

export function noRepoError(dir: string): TenboxError {
  return new TenboxError(`${dir} is not inside a git repository`, "no-repo");
}

export function worktreeError(taskWorktree: string): TenboxError {
  return new TenboxError(`${taskWorktree} exists but is not a git worktree`, "worktree");
}

export function noHeadError(taskWorktree: string): TenboxError {
  return new TenboxError(`${taskWorktree} has no commit yet; commit first`, "no-head");
}
