import type { NumberedQuestion } from "../decisions.ts";
import { questionLines, TenboxError } from "./index.ts";

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

/** A question of `tenbox decide` that fits `count` lines, and the open questions of the file. */
export interface QuestionMiss {
  question: string | number;
  count: number;
  open: NumberedQuestion[];
}

export function unknownQuestionError(miss: QuestionMiss): TenboxError {
  const found = miss.count === 0 ? "no line" : `${miss.count} lines`;
  const named = typeof miss.question === "number" ? miss.question : `"${miss.question}"`;
  const open = questionLines(miss.open);
  const openText =
    open.details.length === 0 ? " No question is open." : ` Open questions:${open.text}`;
  return new TenboxError(
    `${named} fits ${found} of questions.md; it must fit exactly one.${openText}`,
    "unknown-question",
    open.details,
  );
}

export function unknownDecisionError(decision: string, count: number): TenboxError {
  const found = count === 0 ? "no decision" : `${count} decisions`;
  return new TenboxError(
    `"${decision}" fits ${found} of plan.json; it must fit exactly one title`,
    "unknown-decision",
  );
}
