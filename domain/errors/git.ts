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

/** `details` names the base, the PRs, the merge order and the conflicted files. */
export function mergeConflictError(branch: string, details: unknown): TenboxError {
  return new TenboxError(
    `merging ${branch} conflicts with the branches before it`,
    "merge-conflict",
    details,
  );
}

/** `details` is the whole merge-check result, so the failed checks are in it. */
export function newFailuresError(details: unknown): TenboxError {
  return new TenboxError("the merged branches add new check failures", "new-failures", details);
}
