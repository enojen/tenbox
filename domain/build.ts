import path from "node:path";
import { z } from "zod";
import { type ChangedFile, changedLines } from "./changedFile.ts";
import {
  answeredError,
  badFileError,
  badInputError,
  kindRaisedError,
  noDecisionError,
} from "./errors/tasks.ts";
import { usageError } from "./errors/usage.ts";
import type { Group } from "./group.ts";
import {
  DEFAULT_KIND,
  KIND_PRESETS,
  kindForDiff,
  reviewOf,
  type TaskKind,
  TaskKindSchema,
} from "./kind.ts";
import { CHECK_TIER, type CheckTier } from "./manifest.ts";
import type { PlanResult } from "./plan.ts";
import { ProofSchema } from "./proof.ts";
import { jsons, strings } from "./utils.ts";

/** `build.json` in a `.tenbox/` folder: the last build result. */
export const buildFile = (dir: string): string => path.join(dir, "build.json");

/** One line: the card goes into a `decisions.md` bullet and a notification line. */
const oneLine = z
  .string()
  .refine(strings.isNotBlank, "must not be blank")
  .refine((text) => !text.includes("\n"), "must be one line");

const UnprovenSchema = z.object({ part: z.string(), reason: z.string() });

/** The end statuses of `/tenbox-build`. */
export const BUILD_STATUS = {
  readyForYou: "ready-for-you",
  needsYou: "needs-you",
  failed: "failed",
  notApproved: "not-approved",
} as const;

/** What a card is about; the worker picks the closest kind. */
export const CARD_KIND = [
  "migration",
  "data-delete",
  "feature-delete",
  "contract",
  "paid-service",
  "locked-file",
  "scope",
  "other",
] as const;

/** What a blocked worker asks; `recommended` is the 1-based number of one of the options. */
const DecisionCardSchema = z
  .object({
    title: oneLine,
    options: z.array(oneLine).min(1),
    recommended: z.number().int().positive(),
    reason: z.string(),
    auto: z.boolean(),
    kind: z.enum(CARD_KIND),
  })
  .refine((card) => card.recommended <= card.options.length, {
    message: "must be the number of one of the options",
    path: ["recommended"],
  });

/** How a card was answered: the 1-based option, when, and whether no person chose it. */
const AnsweredSchema = z.object({
  option: z.number().int().positive(),
  at: z.iso.datetime(),
  auto: z.boolean(),
});

/** What `/tenbox-build` returns and `tenbox build done` saves; other keys are kept. */
const BuildResultSchema = z.looseObject({
  status: z.enum(BUILD_STATUS),
  round: z.number().int().nonnegative(),
  proofs: z.array(ProofSchema),
  attention: z.array(z.string()),
  nice_to_have: z.array(z.string()),
  unproven: z.array(UnprovenSchema),
  /** The part of the blocked worker, with `needs-you`. */
  part: z.string().optional(),
  decision: DecisionCardSchema.optional(),
  /** When the recommended option is taken; null when the card may not be auto-answered. */
  deadline: z.iso.datetime().nullable().optional(),
  answered: AnsweredSchema.optional(),
  /** The kind the build ran as; missing means the plan's kind. */
  kind: TaskKindSchema.optional(),
});

export type BuildResult = z.infer<typeof BuildResultSchema>;

export type BuildStatus = BuildResult["status"];

/** `tenbox wait --for round` while a round runs: a new `checks.json`, no `build.json` yet. */
export const ROUND_RUNNING = "running";

/** `tenbox wait --for round`: the status of `build.json`, or `running`. */
export type RoundStatus = BuildStatus | typeof ROUND_RUNNING;

export type DecisionCard = NonNullable<BuildResult["decision"]>;

/** A card that waits for an answer, with the round and the part of the blocked worker. */
export interface OpenCard {
  result: BuildResult;
  card: DecisionCard;
  round: number;
  part: string;
}

/** A part a reviewer found without a proof; `part` is the `NN` of the part file name. */
export type Unproven = BuildResult["unproven"][number];

/** The build result in `--json` input; `bad-input` when it is not JSON or does not match. */
export function parseBuild(text: string): BuildResult {
  const result = jsons.check(BuildResultSchema, text);
  if (!result.ok) throw badInputError("the build result", result.issues);
  return result.value;
}

/** The build result in the text of `build.json`; `bad-file` when it is not JSON or does not match. */
export function readBuild(text: string, file: string): BuildResult {
  const result = jsons.check(BuildResultSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}

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

/** The text of the 1-based option; `usage` when the card has no such option. */
export function getOption(card: DecisionCard, option: number): string {
  const text = card.options[option - 1];
  if (!Number.isInteger(option) || text === undefined) {
    throw usageError(`option must be a number from 1 to ${card.options.length}`);
  }
  return text;
}

/** A plan without groups is one group at the full tier, unless its kind forces another. */
const UNGROUPED_TIER = CHECK_TIER.full;

/** The JSON args `tenbox build` sends to `/tenbox-build`. */
export interface BuildArgs {
  task: string;
  kind: TaskKind;
  /** How many rounds the build may review. */
  reviews: number;
  parts: PlanResult["parts"];
  lenses: PlanResult["lenses"];
  groups?: Group[];
}

export interface BuildArgsInput {
  task: string;
  plan: PlanResult;
}

/** The args of a plan, with its lenses and group recipes as its kind gives them. */
export function buildArgs(input: BuildArgsInput): BuildArgs {
  const { task, plan } = input;
  const { kind } = plan;
  const { lenses, reviews } = reviewOf({ kind, lenses: plan.lenses, tier: UNGROUPED_TIER });
  const groups = plan.groups?.map((group) => withKind(group, kind));
  return { task, kind, reviews, parts: plan.parts, lenses, ...(groups && { groups }) };
}

function withKind(group: Group, kind: TaskKind): Group {
  const { recipe } = group;
  const { lenses, tier } = reviewOf({ kind, lenses: recipe.lenses, tier: recipe.tier });
  return { ...group, recipe: { ...recipe, lenses, tier } };
}

/** A plan, or null without `plan.json`, and the kind a build runs as. */
export interface KindPlan {
  plan: PlanResult | null;
  kind: TaskKind;
}

/** One group and the check tier its recipe has under the kind. */
export interface GroupTier {
  group: number;
  tier: CheckTier;
}

/** The tier of each group under the kind; a plan without groups is group 1. */
export function groupTiers(input: KindPlan): GroupTier[] {
  const { plan, kind } = input;
  if (!plan?.groups) {
    return [{ group: 1, tier: reviewOf({ kind, lenses: [], tier: UNGROUPED_TIER }).tier }];
  }
  return plan.groups.map((group) => ({ group: group.id, tier: withKind(group, kind).recipe.tier }));
}

export interface BuildKindInput {
  result: BuildResult;
  plan: PlanResult | null;
}

/** The kind a build result runs as: its own, else the plan's, else the default. */
export function buildKind(input: BuildKindInput): TaskKind {
  const { result, plan } = input;
  return result.kind ?? plan?.kind ?? DEFAULT_KIND;
}

/** The files of several diffs with each path once, at its largest change. */
export function uniqueFiles(diffs: ChangedFile[][]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const file of diffs.flat()) {
    const known = byPath.get(file.path);
    if (known === undefined || changedLines([file]) > changedLines([known]))
      byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

/** The kind a build runs as, its plan and the files its diff changed. */
export interface KindDiff extends KindPlan {
  files: ChangedFile[];
}

/** `kind-raised` when the diff is over the limits of the kind, with the review of the kind it fits. */
export function assertKindFits(input: KindDiff): void {
  const { kind, plan, files } = input;
  const fitting = kindForDiff({ kind, files });
  if (fitting === kind) return;
  const { lenses } = reviewOf({ kind: fitting, lenses: plan?.lenses ?? [], tier: UNGROUPED_TIER });
  const reviews = KIND_PRESETS[fitting].reviews;
  const diff = { files: files.length, lines: changedLines(files) };
  throw kindRaisedError({ from: kind, kind: fitting, lenses, reviews, diff });
}
