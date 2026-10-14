import path from "node:path";
import { z } from "zod";
import { badDecisionsError, unknownQuestionError } from "./errors/tasks.ts";
import { isFilled, issueLines, parseJson } from "./utils.ts";

const filled = z.string().refine(isFilled, "must not be blank");
/** One line: a newline would break the `- ` entry and the check for an entry already there. */
const oneLine = filled.refine((text) => !text.includes("\n"), "must be one line");

/** `decisions.md` in a `.tenbox/` folder. */
export const decisionsFile = (dir: string): string => path.join(dir, "decisions.md");
/** `questions.md` in a `.tenbox/` folder. */
export const questionsFile = (dir: string): string => path.join(dir, "questions.md");

/** An answer to a question of `questions.md`; without `question` it is a note. */
const DecisionSchema = z.object({ question: oneLine.optional(), answer: oneLine });
export type Decision = z.infer<typeof DecisionSchema>;

/** The decisions in the text; `bad-decisions` unless it is a JSON array of valid decisions. */
export function parseDecisions(text: string): Decision[] {
  const parsed = z.array(DecisionSchema).safeParse(parseJson(text));
  if (!parsed.success) throw badDecisionsError(issueLines(parsed.error));
  return parsed.data;
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
