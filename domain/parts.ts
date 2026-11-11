import type { Decision } from "./decisions.ts";
import type { PlanPart } from "./plans.ts";

const PART_ID = /^[^-.]+/;

/** The `NN` of a part name `NN-<slug>` or a part file name `NN-<slug>.md`. */
export function partIdOf(fileName: string): string {
  return PART_ID.exec(fileName)?.[0] ?? fileName;
}

export const PART_STATUS = {
  todo: "todo",
  doing: "doing",
  done: "done",
  blocked: "blocked",
} as const;

const PART_STATUSES = Object.values(PART_STATUS);

export type PartStatus = (typeof PART_STATUS)[keyof typeof PART_STATUS];

/** How many parts have each status. */
export type PartCounts = Record<PartStatus, number>;

const STATUS_LINE = /^status:\s*(\S+)/m;

/** The `status:` line of a part file; `todo` when it is missing or not one of the four. */
export function readPartStatus(text: string): PartStatus {
  const word = STATUS_LINE.exec(text)?.[1];
  return PART_STATUSES.find((status) => status === word) ?? PART_STATUS.todo;
}

const RESULT_LINE = /^result:[ \t]*(.*\S)/m;

/** The `result:` line of a part file; null when it is missing or empty. */
export function readPartResult(text: string): string | null {
  return RESULT_LINE.exec(text)?.[1] ?? null;
}

export function countParts(statuses: PartStatus[]): PartCounts {
  const counts: PartCounts = { todo: 0, doing: 0, done: 0, blocked: 0 };
  for (const status of statuses) counts[status] += 1;
  return counts;
}

export interface PartReopen {
  text: string;
  accept: string;
}

export interface PartAcceptance {
  part: string;
  accept: string;
}

/** The note that keeps a worker from asking whether a reopened part's new line is in scope. */
export function reopenDecision(reopened: PartAcceptance): Decision {
  const line = `Part ${reopened.part} was reopened with the acceptance line \`${reopened.accept}\`.`;
  const rule =
    "This line is final: build it and return no decision card, also when plan.md and plan.json do not name it.";
  return { answer: `${line} ${rule}` };
}

const ACCEPTANCE_HEADER = "acceptance:";
const LIST_ITEM = "- ";
const RESULT_PREFIX = /^result:[ \t]*/;

/** The part file of a reopened part: status todo, one more acceptance line, old results as history. */
export function reopenPart(reopen: PartReopen): string {
  const lines = reopen.text.split("\n").map((line) => line.replace(STATUS_LINE, "status: todo"));
  const accepted = addAcceptance(lines, `${LIST_ITEM}${reopen.accept}`);
  const kept = accepted.flatMap(resultAsHistory);
  while (kept.at(-1) === "") kept.pop();
  return `${[...kept, "result:"].join("\n")}\n`;
}

function addAcceptance(lines: string[], item: string): string[] {
  const header = lines.indexOf(ACCEPTANCE_HEADER);
  if (header === -1) return addAcceptanceBlock(lines, item);
  let last = header;
  while (lines[last + 1]?.startsWith(LIST_ITEM)) last += 1;
  return lines.toSpliced(last + 1, 0, item);
}

function addAcceptanceBlock(lines: string[], item: string): string[] {
  const result = lines.findIndex((line) => RESULT_PREFIX.test(line));
  const at = result === -1 ? lines.length : result;
  return lines.toSpliced(at, 0, ACCEPTANCE_HEADER, item);
}

function resultAsHistory(line: string): string[] {
  if (!RESULT_PREFIX.test(line)) return [line];
  const text = line.replace(RESULT_PREFIX, "").trim();
  return text === "" ? [] : [`history: ${text}`];
}

const FILES_LINE = /^files:(.*)$/m;

/** The paths of the `files:` line of a part file, split on commas; empty when it is missing. */
export function readPartFiles(text: string): string[] {
  const line = FILES_LINE.exec(text)?.[1] ?? "";
  return line
    .split(",")
    .map((file) => file.trim())
    .filter((file) => file !== "");
}

export interface PartFile {
  part: string;
  file: string;
  files: string[];
}

const STALE_REASON = {
  notInPlan: "not in the plan",
  noPartFile: "no part file",
  filesDiffer: "files differ",
} as const;

type StaleReason = (typeof STALE_REASON)[keyof typeof STALE_REASON];

/** A part file that does not match the plan, or a plan part with no part file (`file` null). */
export interface StalePart {
  part: string;
  file: string | null;
  reason: StaleReason;
}

export interface PartsOnDisk {
  planParts: PlanPart[];
  partFiles: PartFile[];
}

/** The part files that hold another plan than `planParts`, in part id order. */
export function findStaleParts(input: PartsOnDisk): StalePart[] {
  const { planParts, partFiles } = input;
  const planned = new Set(planParts.map((part) => part.id));
  const notInPlan = partFiles
    .filter((partFile) => !planned.has(partFile.part))
    .map((partFile) => ({
      part: partFile.part,
      file: partFile.file,
      reason: STALE_REASON.notInPlan,
    }));
  const stale = [...planParts.flatMap((part) => checkPlanPart(part, partFiles)), ...notInPlan];
  return stale.sort((a, b) => a.part.localeCompare(b.part));
}

function checkPlanPart(part: PlanPart, partFiles: PartFile[]): StalePart[] {
  const partFile = partFiles.find((candidate) => candidate.part === part.id);
  if (!partFile) return [{ part: part.id, file: null, reason: STALE_REASON.noPartFile }];
  if (isSameSet(part.files ?? [], partFile.files)) return [];
  return [{ part: part.id, file: partFile.file, reason: STALE_REASON.filesDiffer }];
}

function isSameSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
}
