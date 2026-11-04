import { BUILD_STATUS, type BuildResult, type DecisionCard, isAutoAllowed } from "./builds.ts";
import { answeredError, noDecisionError } from "./errors/builds.ts";
import type { TaskId } from "./ids.ts";
import { jsons, objects } from "./utils.ts";

/* An answer: the option a person chose on a decision card, or the recommended one once
 * the deadline of an `auto` card passed (an auto answer). */

/** What `/tenbox-build` gets in its args: only that round's worker of that part sees it. */
interface WorkflowAnswer {
  round: number;
  part: string;
  option: number;
  text: string;
}

/** A card that waits for an answer, with the round and the part of the blocked worker. */
export interface OpenCard {
  result: BuildResult;
  card: DecisionCard;
  round: number;
  part: string;
}

/** One answer on a card, for its `decisions.md` line. */
export interface AnswerNote {
  card: DecisionCard;
  option: number;
  text: string;
  /** True when no person chose it: the deadline passed. */
  auto: boolean;
}

/** The run's own args and the answer to add to them. */
export interface RunAnswer {
  id: TaskId;
  /** The `args` the run started with: an object, its JSON text from `tenbox build`, or the task id. */
  runArgs: unknown;
  answer: WorkflowAnswer;
}

/** Added to the `decisions.md` line of an answer no person chose. */
const AUTO_NOTE = "(auto: no answer in 30 min)";

/** The card to answer; `no-decision` without a `needs-you` card, `answered` once answered. */
export function getOpenCard(result: BuildResult | null, id: string): OpenCard {
  const card = result?.decision;
  const part = result?.part;
  if (result?.status !== BUILD_STATUS.needsYou || card === undefined || part === undefined) {
    throw noDecisionError(id);
  }
  if (result.answered !== undefined) throw answeredError(id, result.answered.option);
  return { result, card, round: result.round, part };
}

/** One `decisions.md` line: the card title and the chosen option. */
export function answerNote(note: AnswerNote): string {
  const { card, option, text, auto } = note;
  const line = `${card.title} Answer: ${option}. ${text}`;
  return auto ? `${line} ${AUTO_NOTE}` : line;
}

/** The run's own args plus the answer; JSON text is parsed, anything else becomes `{ task }`. */
export function argsWithAnswer(input: RunAnswer): object {
  const { id, runArgs, answer } = input;
  const parsed = typeof runArgs === "string" ? jsons.parse(runArgs) : runArgs;
  const base = objects.isRecord(parsed) ? parsed : { task: id };
  return { ...base, answer };
}

/** How `tenbox answer --auto` ends. */
export const AUTO_ANSWER_STATE = { answered: "answered", skipped: "skipped" } as const;

/** 30 minutes: a card that may be auto-answered waits this long for a person. */
const AUTO_ANSWER_MS = 1_800_000;

/** A card that `tenbox answer --auto` may answer: its deadline and its recommended option. */
export interface AutoCard {
  deadline: string;
  recommended: number;
}

/** The card's `deadline`: `now` + 30 minutes when auto is allowed, else null; no key without a card. */
export function addDeadline(result: BuildResult, now: Date): BuildResult {
  const { decision } = result;
  if (decision === undefined) return result;
  const deadline = isAutoAllowed(decision)
    ? new Date(now.getTime() + AUTO_ANSWER_MS).toISOString()
    : null;
  return { ...result, deadline };
}

/** The open, unanswered `needs-you` card with `auto`; null for anything else. */
export function autoCardOf(result: BuildResult | null): AutoCard | null {
  if (result?.status !== BUILD_STATUS.needsYou || result.answered !== undefined) return null;
  const { decision, deadline } = result;
  if (decision === undefined || !isAutoAllowed(decision) || typeof deadline !== "string")
    return null;
  return { deadline, recommended: decision.recommended };
}
