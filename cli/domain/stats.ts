import path from "node:path";
import type { StatsProof } from "./proof.ts";
import type { RunAgent, RunMinutes, RunReview, RunTimeline, RunUnproven } from "./runs.ts";
import { parseObject } from "./utils.ts";

/* The record `tenbox close` writes to `<archive>/stats.json`: numbers, labels and the worker proofs. */

export const STATS_SCHEMA = 3;

/** `<archive>/stats.json`. */
export const statsFile = (archive: string): string => path.join(archive, "stats.json");

const TEST_FILE_SUFFIX = ".test.ts";
const TEST_DIR = "test";
const ESTIMATED_LINES = /^Estimated lines:\s*(\d+)/im;
const DIFFICULTY_LINE = /^difficulty:\s*(\S+)/m;

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

/** +1 per distinct proof, -1 per unproven item. */
export interface StatsPoints {
  part: string;
  points: number;
}

export interface PointsInput {
  partIds: string[];
  proofs: StatsProof[];
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

/** The proofs in order; a part, test file and test name seen again is dropped. */
export function distinctProofs(proofs: StatsProof[]): StatsProof[] {
  const seen = new Set<string>();
  return proofs.filter((proof) => {
    const key = [proof.part, proof.file, proof.test].join("\n");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One entry per part id, then one per other part id an unproven item names. */
export function countPoints(input: PointsInput): StatsPoints[] {
  const { partIds, proofs, unproven } = input;
  const points = new Map<string, number>(partIds.map((part) => [part, 0]));
  const add = (part: string, delta: number) => points.set(part, (points.get(part) ?? 0) + delta);
  for (const proof of proofs) add(proof.part, 1);
  for (const item of unproven) add(item.part, -1);
  return [...points].map(([part, total]) => ({ part, points: total }));
}
