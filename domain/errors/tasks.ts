import { TenboxError } from "./index.ts";

export function noWorktreeError(id: string): TenboxError {
  return new TenboxError(`no worktree for ${id}; run: tenbox start ${id}`, "no-worktree");
}

export function noPlanError(dir: string): TenboxError {
  return new TenboxError(`no plan.md in ${dir}; run /tenbox-plan first`, "no-plan");
}

export function notApprovedError(id: string): TenboxError {
  return new TenboxError(`${id} has no approved plan; run: tenbox approve ${id}`, "not-approved");
}

export function planChangedError(id: string): TenboxError {
  return new TenboxError(
    `plan.md changed after the approval; run: tenbox approve ${id}`,
    "plan-changed",
  );
}

export function noSessionError(id: string): TenboxError {
  return new TenboxError(`${id} has no background session; run: tenbox build ${id}`, "no-session");
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

export function badPlanError(issues: string[]): TenboxError {
  return new TenboxError(`the plan result is not valid: ${issues.join("; ")}`, "bad-plan", issues);
}

export function setupError(exitCode: number, cmd: string, output: string): TenboxError {
  return new TenboxError(`setup failed (exit ${exitCode}): ${cmd}`, "setup", { output });
}

export function badBuildError(issues: string[]): TenboxError {
  return new TenboxError(
    `the build result is not valid: ${issues.join("; ")}`,
    "bad-build",
    issues,
  );
}

export function waitTimeoutError(file: string, seconds: number): TenboxError {
  return new TenboxError(`${file} did not appear within ${seconds} seconds`, "wait-timeout");
}

export function mergeCommitError(branch: string): TenboxError {
  return new TenboxError(
    `${branch} was merged as a merge commit; squash merge it, or close it with --force`,
    "merge-commit",
  );
}

export function inTaskWorktreeError(taskWorktree: string): TenboxError {
  return new TenboxError(
    `run tenbox close outside ${taskWorktree}; it removes that directory`,
    "in-task-worktree",
  );
}

export function badDecisionsError(issues: string[]): TenboxError {
  return new TenboxError(
    `the decisions are not valid: ${issues.join("; ")}`,
    "bad-decisions",
    issues,
  );
}

export function unknownQuestionError(question: string, count: number): TenboxError {
  const found = count === 0 ? "no line" : `${count} lines`;
  return new TenboxError(
    `"${question}" fits ${found} of questions.md; it must fit exactly one`,
    "unknown-question",
  );
}

export function noStatsError(id: string): TenboxError {
  return new TenboxError(
    `${id} has no stats.json and no Claude Code session files; run: tenbox start ${id}`,
    "no-stats",
  );
}

export function oldStatsError(id: string): TenboxError {
  return new TenboxError(
    `${id} has a stats.json of an older schema without token numbers and no Claude Code session files`,
    "old-stats",
  );
}
