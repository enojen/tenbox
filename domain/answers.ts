import { BUILD_STATUS, type BuildResult, type DecisionCard } from "./build.ts";
import type { TaskId } from "./ids.ts";
import { isPlainObject } from "./utils.ts";

/** What `/tenbox-build` gets in its args: only that round's worker of that part sees it. */
interface WorkflowAnswer {
  round: number;
  part: string;
  option: number;
  text: string;
}

/** How `tenbox answer --auto` ends. */
export const AUTO_ANSWER_STATE = { answered: "answered", skipped: "skipped" } as const;

/** A card that `tenbox answer --auto` may answer: its deadline and its recommended option. */
export interface AutoCard {
  deadline: string;
  recommended: number;
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
  /** The `args` the run started with: the task id, or an object. */
  runArgs: unknown;
  answer: WorkflowAnswer;
}

/** Added to the `decisions.md` line of an answer no person chose. */
const AUTO_NOTE = "(auto: no answer in 30 min)";

/** One `decisions.md` line: the card title and the chosen option. */
export function answerNote(note: AnswerNote): string {
  const { card, option, text, auto } = note;
  const line = `${card.title} Answer: ${option}. ${text}`;
  return auto ? `${line} ${AUTO_NOTE}` : line;
}

/** The run's own args plus the answer; a task id string becomes `{ task }`. */
export function argsWithAnswer(input: RunAnswer): object {
  const { id, runArgs, answer } = input;
  if (typeof runArgs === "string") return { task: runArgs, answer };
  const base = isPlainObject(runArgs) ? runArgs : { task: id };
  return { ...base, answer };
}

/** The open, unanswered `needs-you` card with `auto`; null for anything else. */
export function autoCardOf(result: BuildResult | null): AutoCard | null {
  if (result?.status !== BUILD_STATUS.needsYou || result.answered !== undefined) return null;
  const { decision, deadline } = result;
  if (decision?.auto !== true || typeof deadline !== "string") return null;
  return { deadline, recommended: decision.recommended };
}
