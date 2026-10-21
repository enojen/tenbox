import { TenboxError } from "./index.ts";

export function noWorktreeError(id: string): TenboxError {
  return new TenboxError(`no worktree for ${id}; run: tenbox start ${id}`, "no-worktree");
}

export function noPlanError(dir: string): TenboxError {
  return new TenboxError(`no plan.md in ${dir}; run /tenbox-plan first`, "no-plan");
}

export function noPlanResultError(dir: string): TenboxError {
  return new TenboxError(`no valid plan.json in ${dir}; run /tenbox-plan first`, "no-plan");
}

export function notApprovedError(id: string): TenboxError {
  return new TenboxError(`${id} has no approved plan; run: tenbox approve ${id}`, "not-approved");
}

export function planChangedError(id: string): TenboxError {
  return new TenboxError(
    `plan.json changed after the approval; run: tenbox approve ${id}`,
    "plan-changed",
  );
}

export function noSessionError(id: string): TenboxError {
  return new TenboxError(`${id} has no background session; run: tenbox build ${id}`, "no-session");
}

export function sessionBusyError(id: string): TenboxError {
  return new TenboxError(
    `${id} has a busy background session; run: tenbox attach ${id}`,
    "session-busy",
  );
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

export function partNotCommittedError(part: string, reason: string): TenboxError {
  return new TenboxError(`part ${part} is not committed: ${reason}`, "part-not-committed");
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

export function unknownDecisionError(decision: string, count: number): TenboxError {
  const found = count === 0 ? "no decision" : `${count} decisions`;
  return new TenboxError(
    `"${decision}" fits ${found} of plan.json; it must fit exactly one title`,
    "unknown-decision",
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

export function noDecisionError(id: string): TenboxError {
  return new TenboxError(`${id} has no needs-you decision card in build.json`, "no-decision");
}

export function answeredError(id: string, option: number): TenboxError {
  return new TenboxError(`the decision card of ${id} is answered: option ${option}`, "answered");
}

export function noRunError(id: string): TenboxError {
  return new TenboxError(
    `${id} has no tenbox-build run in the Claude Code session files; run: tenbox build ${id}`,
    "no-run",
  );
}

export function unknownGroupError(id: string, group: number): TenboxError {
  return new TenboxError(`the plan of ${id} has no group ${group}`, "unknown-group");
}

export function groupMergeConflictError(
  branch: string,
  needs: string[],
  files: string[],
): TenboxError {
  return new TenboxError(
    `merging ${needs.join(", ")} into ${branch} conflicts: ${files.join(", ")}`,
    "merge-conflict",
    { branch, needs, files },
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

export interface CheckFailed {
  id: string;
  group: number;
  /** `fast`: the latest `checks.json`; `full`: the full tier `tenbox build done` ran. */
  tier: string;
  summary: string;
}

/** `details` keeps the group and the tier, so the workflow can tell a failed full tier apart. */
export function checkFailedError(input: CheckFailed): TenboxError {
  const { id, group, tier, summary } = input;
  return new TenboxError(
    `group ${group}: the ${tier} checks of ${id} have new failures:\n${summary}`,
    "check-failed",
    { group, tier },
  );
}

/** `result` is the whole `tenbox pr` result, with the `ci` of each group. */
export function ciFailedError(result: unknown): TenboxError {
  return new TenboxError("the CI checks of a PR failed", "ci-failed", result);
}

export function ciTimeoutError(result: unknown): TenboxError {
  return new TenboxError("the CI checks of a PR did not finish in time", "ci-timeout", result);
}
