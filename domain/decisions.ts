import { z } from "zod";
import { badInputError } from "./errors/index.ts";
import { unknownDecisionError, unknownQuestionError } from "./errors/plans.ts";
import type { PlanDecision, PlanResult } from "./plans.ts";
import { jsons, strings } from "./utils.ts";

const filled = z.string().refine(strings.isNotBlank, "must not be blank");
/** One line: a newline would break the `- ` entry and the check for an entry already there. */
const oneLine = filled.refine((text) => !text.includes("\n"), "must be one line");

/** An answer to a question of `questions.md`; without `question` it is a note. */
const DecisionSchema = z.object({ question: oneLine.optional(), answer: oneLine });
export type Decision = z.infer<typeof DecisionSchema>;

/** The option, counted from 1, to take on the one plan decision whose title contains `decision`. */
const DecisionTakenSchema = z.object({ decision: oneLine, taken: z.number().int().min(1) });
export type DecisionTaken = z.infer<typeof DecisionTakenSchema>;

/** One item of `tenbox decide`. */
export type DecideItem = Decision | DecisionTaken;

export const isDecisionTaken = (item: DecideItem): item is DecisionTaken => "decision" in item;

/** What `tenbox decide --json` holds, as a `bad-input` message names it. */
const DECISIONS_INPUT = "the decisions";

/** The items in `--json` input; `bad-input` unless it is a JSON array of valid items. */
export function parseDecisions(text: string): DecideItem[] {
  const item = z.union([DecisionSchema, DecisionTakenSchema]);
  const result = jsons.check(z.array(item), text);
  if (!result.ok) throw badInputError(DECISIONS_INPUT, result.issues);
  return result.value;
}

/** The plan with the options taken, and one note `<title>: <option text>` per item. */
export interface OptionsTaken {
  plan: PlanResult;
  notes: Decision[];
}

/**
 * Sets `taken` on the plan decision of each item. Throws `unknown-decision` when the text fits
 * other than one title, `bad-input` when `taken` is not one of its options.
 */
export function takeOptions(plan: PlanResult, items: DecisionTaken[]): OptionsTaken {
  const changed = structuredClone(plan);
  const notes = items.map((item) => {
    const card = findPlanDecision(changed.decisions, item.decision.trim());
    const option = card.options[item.taken - 1];
    if (option === undefined) {
      const count = card.options.length;
      throw badInputError(DECISIONS_INPUT, [
        `"${card.title}" has ${count} options; ${item.taken} is not one`,
      ]);
    }
    card.taken = item.taken;
    return { answer: `${card.title}: ${option}` };
  });
  return { plan: changed, notes };
}

function findPlanDecision(cards: PlanDecision[], text: string): PlanDecision {
  const found = cards.filter((card) => card.title.includes(text));
  const [only] = found;
  if (found.length !== 1 || only === undefined) throw unknownDecisionError(text, found.length);
  return only;
}

/** The text of the two files, `""` when a file is missing. */
export interface DecisionTexts {
  decisions: string;
  questions: string;
}

export interface DecisionsApplied extends DecisionTexts {
  added: number;
  ticked: number;
}

const QUESTION_LINE = /^- \[[ x]\] /;
const OPEN_BOX = "- [ ] ";
const TICKED_BOX = "- [x] ";
const BLOCKING = /^\(blocking\) /;

/**
 * Appends each decision that is not yet in `decisions.md` and ticks its question line.
 * Throws `unknown-question` before any result when a question fits other than one line.
 */
export function applyDecisions(items: Decision[], texts: DecisionTexts): DecisionsApplied {
  const questionLines = texts.questions.split("\n");
  const decisionLines = texts.decisions.split("\n");
  let added = 0;
  let ticked = 0;
  const entries: string[][] = [];
  for (const item of items) {
    const built = buildEntry(item, questionLines);
    if (built.ticked) ticked += 1;
    if (containsBlock(decisionLines, built.entry)) continue;
    decisionLines.push(...built.entry);
    entries.push(built.entry);
    added += 1;
  }
  return {
    decisions: appendEntries(texts.decisions, entries),
    questions: questionLines.join("\n"),
    added,
    ticked,
  };
}

interface BuiltEntry {
  entry: string[];
  ticked: boolean;
}

/** The `decisions.md` lines of one item; ticks its open question line in `questionLines`. */
function buildEntry(item: Decision, questionLines: string[]): BuiltEntry {
  const answer = item.answer.trim();
  if (item.question === undefined) return { entry: [`- ${answer}`], ticked: false };
  const index = findQuestionLine(questionLines, item.question.trim());
  const line = questionLines[index] ?? "";
  const entry = [`- ${questionText(line)}`, `  Answer: ${answer}`];
  if (!line.startsWith(OPEN_BOX)) return { entry, ticked: false };
  questionLines[index] = TICKED_BOX + line.slice(OPEN_BOX.length);
  return { entry, ticked: true };
}

function findQuestionLine(lines: string[], question: string): number {
  const found = lines.flatMap((line, index) =>
    QUESTION_LINE.test(line) && line.includes(question) ? [index] : [],
  );
  const [only] = found;
  if (found.length !== 1 || only === undefined) throw unknownQuestionError(question, found.length);
  return only;
}

/** The line without its checkbox and `(blocking) `. */
function questionText(line: string): string {
  return line.replace(QUESTION_LINE, "").replace(BLOCKING, "");
}

function containsBlock(lines: string[], block: string[]): boolean {
  return lines.some((_, start) => block.every((line, offset) => lines[start + offset] === line));
}

function appendEntries(text: string, entries: string[][]): string {
  if (entries.length === 0) return text;
  const separator = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${separator}${entries.flat().join("\n")}\n`;
}
