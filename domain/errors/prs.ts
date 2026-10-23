import { TenboxError } from "./index.ts";

/* Errors of a PR, from push to close: dirty worktree, CI, merge. */

export function dirtyBeforePrError(taskWorktree: string): TenboxError {
  return new TenboxError(`${taskWorktree} has uncommitted changes; commit them first`, "dirty");
}

export function dirtyBeforeCloseError(taskWorktree: string): TenboxError {
  return new TenboxError(
    `${taskWorktree} has uncommitted changes; commit them or pass --force`,
    "dirty",
  );
}

export function unmergedError(branch: string, base: string): TenboxError {
  return new TenboxError(
    `${branch} has changes that are not on ${base}; merge it or pass --force`,
    "unmerged",
  );
}

export function noCommitsError(branch: string, base: string): TenboxError {
  return new TenboxError(`${branch} has no commits ahead of ${base}`, "no-commits");
}

export interface MergeCommitInput {
  branch: string;
  base: string;
  /** Why the head is not known to be in the base: it is missing, or the fetch failed. */
  reason: string;
}

export function mergeCommitError(input: MergeCommitInput): TenboxError {
  const { branch, base, reason } = input;
  return new TenboxError(
    `${branch} was merged as a merge commit and ${reason}; push the work to ${base} or fix the fetch, then close again (--force skips every check)`,
    "merge-commit",
  );
}

export function inTaskWorktreeError(taskWorktree: string): TenboxError {
  return new TenboxError(
    `run tenbox close outside ${taskWorktree}; it removes that directory`,
    "in-task-worktree",
  );
}

export interface ChecksStale {
  id: string;
  group: number;
  /** The commit of the latest round's checks.json; null when no round ran. */
  checked: string | null;
  head: string;
}

export function checksStaleError(input: ChecksStale): TenboxError {
  const { id, group, checked, head } = input;
  const ran = checked === null ? "no tenbox check ran" : `tenbox check ran at ${checked}`;
  const flag = group > 1 ? ` --group ${group}` : "";
  return new TenboxError(
    `group ${group}: ${ran}, HEAD is ${head}; run: tenbox check ${id}${flag}, or pass --force`,
    "checks-stale",
  );
}

/** `result` is the whole `tenbox pr` result, with the `ci` of each group. */

export function ciFailedError(result: unknown): TenboxError {
  return new TenboxError("the CI checks of a PR failed", "ci-failed", result);
}

export function ciTimeoutError(result: unknown): TenboxError {
  return new TenboxError("the CI checks of a PR did not finish in time", "ci-timeout", result);
}
