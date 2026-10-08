import path from "node:path";
import type { RunAgent, RunMinutes, RunReview, RunTimeline, RunUnproven } from "./runs.ts";
import { parseObject } from "./utils.ts";

/* The record `tenbox close` writes to `<archive>/stats.json`: numbers, labels and the proof lines of the parts. */

export const STATS_SCHEMA = 2;

/** `<archive>/stats.json`. */
export const statsFile = (archive: string): string => path.join(archive, "stats.json");

const TEST_FILE_SUFFIX = ".test.ts";
const TEST_DIR = "test";
const ESTIMATED_LINES = /^Estimated lines:\s*(\d+)/im;
const DIFFICULTY_LINE = /^difficulty:\s*(\S+)/m;
const PROOFS_HEADER = /^proofs:\s*$/;
const PROOF_LINE = /^-\s+(.+?) > (.+): got (.+)$/;
const PART_ID = /^[^-.]+/;

export interface StatsTimeline extends RunTimeline {
  opened: string | null;
  closed: string;
}

export interface StatsMinutes extends RunMinutes {
  total: number | null;
}

export interface StatsPlan {
  parts: number;
  /** Each part's `difficulty:` line, in part order; null when a part has none. */
  difficulty: (string | null)[];
  estimated_lines: number | null;
}

export interface StatsRound {
  number: number;
  /** Null when `checks.json` is missing or unreadable. */
  checks_passed: boolean | null;
}

/** One file of a diff; a binary file counts 0 lines. */
export interface ChangedFile {
  added: number;
  removed: number;
  path: string;
}

export interface StatsCode {
  added: number;
  removed: number;
  files: number;
  test_added: number;
}

/** One worker proof line: the test that failed before the code, and how. */
export interface StatsProof {
  part: string;
  file: string;
  test: string;
  failure: string;
}

/** +1 per proof, -1 per unproven item; `ignored_proofs` counts the malformed lines under `proofs:`. */
export interface StatsPoints {
  part: string;
  points: number;
  ignored_proofs: number;
}

/** The proofs of one part file, and how many of its `proofs:` lines did not match the format. */
export interface ParsedProofs {
  proofs: StatsProof[];
  ignored: number;
}

export interface PointsInput {
  partIds: string[];
  proofs: StatsProof[];
  /** Ignored proof lines per part id. */
  ignored: Record<string, number>;
  unproven: RunUnproven[];
}

export interface TaskStats {
  schema: typeof STATS_SCHEMA;
  project: string;
  task: string;
  title: string | null;
  user: string | null;
  tenbox: string | null;
  forced: boolean;
  timeline: StatsTimeline;
  minutes: StatsMinutes;
  plan: StatsPlan | null;
  rounds: StatsRound[];
  review: RunReview | null;
  proofs: StatsProof[];
  points: StatsPoints[];
  code: StatsCode | null;
  agents: RunAgent[] | null;
}

/** Null without `plan.md`; `partTexts` are the part files in their order. */
export function countPlan(planText: string | null, partTexts: string[]): StatsPlan | null {
  if (planText === null) return null;
  const difficulty = partTexts.map((text) => DIFFICULTY_LINE.exec(text)?.[1] ?? null);
  const lines = ESTIMATED_LINES.exec(planText)?.[1];
  const estimated_lines = lines === undefined ? null : Number(lines);
  return { parts: difficulty.length, difficulty, estimated_lines };
}

export function sumCode(changed: ChangedFile[]): StatsCode {
  const total: StatsCode = { added: 0, removed: 0, files: changed.length, test_added: 0 };
  for (const file of changed) {
    total.added += file.added;
    total.removed += file.removed;
    if (isTestPath(file.path)) total.test_added += file.added;
  }
  return total;
}

function isTestPath(file: string): boolean {
  const directories = file.split("/").slice(0, -1);
  return file.endsWith(TEST_FILE_SUFFIX) || directories.includes(TEST_DIR);
}

/** `ok` from a round's `checks.json`; null when the text is missing or not JSON. */
export function checksPassed(text: string | null): boolean | null {
  if (text === null) return null;
  const parsed = parseObject(text);
  return typeof parsed?.ok === "boolean" ? parsed.ok : null;
}

/** The `NN` of a part file name `NN-<slug>.md`. */
export function partIdOf(fileName: string): string {
  return PART_ID.exec(fileName)?.[0] ?? fileName;
}

/** True the first time a key is seen, false after. */
function isFirstSighting(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/** The `proofs:` block; it ends at the first line not starting with `-`. Other `-` lines are ignored. A test named twice counts once, the first line. */
export function parseProofs(part: string, text: string): ParsedProofs {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => PROOFS_HEADER.test(line));
  const result: ParsedProofs = { proofs: [], ignored: 0 };
  if (start === -1) return result;
  const seen = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("-")) break;
    const [, file, test, failure] = PROOF_LINE.exec(line) ?? [];
    if (!file || !test || !failure) {
      result.ignored += 1;
      continue;
    }
    if (!isFirstSighting(seen, `${file}\n${test}`)) continue;
    result.proofs.push({ part, file, test, failure });
  }
  return result;
}

/** One entry per part id, then one per other part id an unproven item names. */
export function countPoints(input: PointsInput): StatsPoints[] {
  const { partIds, proofs, ignored, unproven } = input;
  const points = new Map<string, number>(partIds.map((part) => [part, 0]));
  const add = (part: string, delta: number) => points.set(part, (points.get(part) ?? 0) + delta);
  for (const proof of proofs) add(proof.part, 1);
  for (const item of unproven) add(item.part, -1);
  return [...points].map(([part, total]) => ({
    part,
    points: total,
    ignored_proofs: ignored[part] ?? 0,
  }));
}
