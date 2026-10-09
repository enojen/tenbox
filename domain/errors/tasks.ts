import { TenboxError } from "./index.ts";

export function noWorktreeError(id: string): TenboxError {
  return new TenboxError(`no worktree for ${id}; run: tenbox start ${id}`, "no-worktree");
}

export function noPlanError(dir: string): TenboxError {
  return new TenboxError(`no plan.md in ${dir}; run /tenbox-plan first`, "no-plan");
}

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

export function unknownPartError(part: string): TenboxError {
  return new TenboxError(`no part file ${part}-*.md in .tenbox/parts`, "unknown-part");
}

export function badProofsError(file: string, problem: string): TenboxError {
  return new TenboxError(`${file} ${problem}`, "bad-proofs");
}

export function setupError(exitCode: number, cmd: string, output: string): TenboxError {
  return new TenboxError(`setup failed (exit ${exitCode}): ${cmd}`, "setup", { output });
}
