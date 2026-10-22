import { BUILD_STATUS, type BuildResult, CARD_KIND, type DecisionCard } from "./build.ts";
import type { TaskId } from "./ids.ts";
import { jsons, objects } from "./utils.ts";

/** What `/tenbox-build` gets in its args: only that round's worker of that part sees it. */
interface WorkflowAnswer {
  round: number;
  part: string;
  option: number;
  text: string;
}

/** How `tenbox answer --auto` ends. */
export const AUTO_ANSWER_STATE = { answered: "answered", skipped: "skipped" } as const;

/** Kinds Tenbox never auto-answers, whatever `auto` says. */
const NEVER_AUTO: readonly DecisionCard["kind"][] = CARD_KIND.filter(
  (kind) => kind !== "scope" && kind !== "other",
);

/** 30 minutes: a card that may be auto-answered waits this long for a person. */
const AUTO_ANSWER_MS = 1_800_000;

/** True when the card has `auto` and its kind is not never-auto. */
export function isAutoAllowed(card: DecisionCard): boolean {
  return card.auto && !NEVER_AUTO.includes(card.kind);
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
  /** The `args` the run started with: an object, its JSON text from `tenbox build`, or the task id. */
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

/** The run's own args plus the answer; JSON text is parsed, anything else becomes `{ task }`. */
export function argsWithAnswer(input: RunAnswer): object {
  const { id, runArgs, answer } = input;
  const parsed = typeof runArgs === "string" ? jsons.parse(runArgs) : runArgs;
  const base = objects.isRecord(parsed) ? parsed : { task: id };
  return { ...base, answer };
}

/** The open, unanswered `needs-you` card with `auto`; null for anything else. */
export function autoCardOf(result: BuildResult | null): AutoCard | null {
  if (result?.status !== BUILD_STATUS.needsYou || result.answered !== undefined) return null;
  const { decision, deadline } = result;
  if (decision === undefined || !isAutoAllowed(decision) || typeof deadline !== "string")
    return null;
  return { deadline, recommended: decision.recommended };
}
