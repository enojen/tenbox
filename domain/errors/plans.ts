import { TenboxError } from "./index.ts";

/* Errors of the plan: plan files, approval, decisions, questions, parts. */

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

export function unknownPartError(part: string): TenboxError {
  return new TenboxError(`no part file ${part}-*.md in .tenbox/parts`, "unknown-part");
}

export function partNotCommittedError(part: string, reason: string): TenboxError {
  return new TenboxError(`part ${part} is not committed: ${reason}`, "part-not-committed");
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
