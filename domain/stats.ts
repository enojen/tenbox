import path from "node:path";
import { z } from "zod";
import { BUILD_STATUS, type BuildResult, type Unproven } from "./build.ts";
import type { ChangedFile } from "./changedFile.ts";
import { badFileError } from "./errors/tasks.ts";
import { partIdOf } from "./part.ts";
import type { PlanResult } from "./plan.ts";
import type { StatsProof } from "./proof.ts";
import {
  type RunAgent,
  RunAgentSchema,
  type RunMark,
  type RunMinutes,
  type RunTimeline,
} from "./runs.ts";
import { jsons } from "./utils.ts";

/* The record `tenbox close` writes to `<task dir>/stats.json`: numbers, labels and the worker proofs. */

export const STATS_SCHEMA = 6;

/** `stats.json` in a task dir. */
export const statsFile = (dir: string): string => path.join(dir, "stats.json");

const TEST_FILE_SUFFIX = ".test.ts";
const TEST_DIR = "test";

interface StatsTimeline extends RunTimeline {
  opened: string | null;
  closed: string;
}

export interface PrMinutes {
  /** Build end to the PR's creation; null without a PR. */
  review: number | null;
  /** The PR's creation to its merge; null without a PR. */
  wait_merge: number | null;
}

interface StatsMinutes extends RunMinutes, PrMinutes {
  total: number | null;
}

/** When GitHub says the PR was created and merged. */
export interface PrTimes {
  createdAt: string;
  mergedAt: string | null;
}

export interface StatsPlan {
  parts: number;
  /** Each part's difficulty, in the order of the plan result. */
  difficulty: string[];
  estimated_lines: number;
}

export interface StatsRound {
  number: number;
  /** Null when `checks.json` is missing or unreadable. */
  checks_passed: boolean | null;
}

export interface StatsCode {
  added: number;
  removed: number;
  files: number;
  test_added: number;
}

/** Counts from the build result; must_fix is 0 for a ready result, null otherwise. */
export interface StatsReview {
  must_fix: number | null;
  nice_to_have: number;
  attention: number;
}

/** +1 per distinct proof, -1 per unproven item. */
export interface StatsPoints {
  part: string;
  points: number;
}

export interface PointsInput {
  partIds: string[];
  proofs: StatsProof[];
  unproven: Unproven[];
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
  review: StatsReview | null;
  proofs: StatsProof[];
  points: StatsPoints[];
  code: StatsCode | null;
  agents: RunAgent[] | null;
  /** The runs since the task opened; finished is false for a run with no run file. */
  runs: RunMark[] | null;
}

/** Null without a plan result. */
export function countPlan(plan: PlanResult | null): StatsPlan | null {
  if (plan === null) return null;
  const difficulty = plan.parts.map((part) => part.difficulty);
  return { parts: difficulty.length, difficulty, estimated_lines: plan.estimated_lines };
}

/** Null without a build result. */
export function countReview(build: BuildResult | null): StatsReview | null {
  if (build === null) return null;
  return {
    must_fix: build.status === BUILD_STATUS.readyForYou ? 0 : null,
    nice_to_have: build.nice_to_have.length,
    attention: build.attention.length,
  };
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

/** The proofs in order with the part number as part; a part, file and test seen again is dropped. */
export function distinctProofs(proofs: StatsProof[]): StatsProof[] {
  const seen = new Set<string>();
  const numbered = proofs.map((proof) => ({ ...proof, part: partIdOf(proof.part) }));
  return numbered.filter((proof) => {
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
  for (const item of unproven) add(partIdOf(item.part), -1);
  return [...points].map(([part, total]) => ({ part, points: total }));
}

const TOKENS_PER_K = 1000;

/** The close comment: total minutes, output tokens in thousands, number of rounds. */
export function costComment(stats: TaskStats): string {
  const output = (stats.agents ?? []).reduce((sum, agent) => sum + (agent.output ?? 0), 0);
  const minutes = Math.round(stats.minutes.total ?? 0);
  const tokens = Math.round(output / TOKENS_PER_K);
  return `${minutes} min, ${tokens}k tokens, ${stats.rounds.length} rounds`;
}

/** Schema 5 has the same agents, only no `runs`. */
const READABLE_SCHEMA = 5;

const RunMarkSchema = z.object({
  workflow: z.string(),
  started: z.iso.datetime(),
  finished: z.boolean(),
});

const StatsRecordSchema = z.object({
  schema: z.union([z.literal(READABLE_SCHEMA), z.literal(STATS_SCHEMA)]),
  agents: z.array(RunAgentSchema).nullable(),
  runs: z.array(RunMarkSchema).nullable().optional(),
});

/** What `tenbox stats` reads back from `stats.json`. */
export interface StatsRecord {
  agents: RunAgent[];
  /** Null for schema 5, which has no `runs`. */
  runs: RunMark[] | null;
}

/** Only the schema number, to tell an older `stats.json` from a broken one. */
const StatsVersionSchema = z.object({ schema: z.number().int() });

/**
 * The agents and runs in the text of `stats.json`; no agents when it had no session files.
 * Null for an older schema; `bad-file` when it is not JSON or does not match a readable schema.
 */
export function readStatsRecord(text: string, file: string): StatsRecord | null {
  const version = jsons.check(StatsVersionSchema, text);
  if (version.ok && version.value.schema < READABLE_SCHEMA) return null;
  const result = jsons.check(StatsRecordSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return { agents: result.value.agents ?? [], runs: result.value.runs ?? null };
}
