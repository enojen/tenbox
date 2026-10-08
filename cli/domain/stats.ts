import path from "node:path";
import type { RunAgent, RunMinutes, RunReview, RunTimeline } from "./runs.ts";
import { parseObject } from "./utils.ts";

/* The record `tenbox close` writes to `<archive>/stats.json`: numbers and labels only. */

export const STATS_SCHEMA = 1;

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
