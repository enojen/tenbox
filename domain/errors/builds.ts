import type { Lens, TaskKind } from "../kinds.ts";
import { TenboxError } from "./index.ts";

/* Errors of a build: groups, checks, the kind's limits, decision cards. */

export function noDecisionError(id: string): TenboxError {
  return new TenboxError(`${id} has no needs-you decision card in build.json`, "no-decision");
}

export function answeredError(id: string, option: number): TenboxError {
  return new TenboxError(`the decision card of ${id} is answered: option ${option}`, "answered");
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

/** The size of a diff: files and changed lines. */
interface DiffSize {
  files: number;
  lines: number;
}

export interface KindRaised {
  /** The kind the build ran as. */
  from: TaskKind;
  /** The smallest kind whose limits the diff fits, and its review. */
  kind: TaskKind;
  lenses: Lens[];
  reviews: number;
  diff: DiffSize;
}

/** `details` is what the next build round runs: the new kind, its lenses and review rounds. */

export function kindRaisedError(input: KindRaised): TenboxError {
  const { from, kind, lenses, reviews, diff } = input;
  return new TenboxError(
    `the diff (${diff.files} files, ${diff.lines} changed lines) is over the limits of kind ${from}; it is ${kind} now`,
    "kind-raised",
    { kind, lenses, reviews },
  );
}
