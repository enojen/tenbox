import { z } from "zod";
import { AnsweredSchema, DecisionCardSchema } from "./cards.ts";
import { type DiffFile, diffLines } from "./diffs.ts";
import { kindRaisedError } from "./errors/builds.ts";
import { badFileError, badInputError } from "./errors/index.ts";
import type { Group } from "./groups.ts";
import {
  DEFAULT_KIND,
  KIND_PRESETS,
  kindForDiff,
  type Lens,
  reviewOf,
  type TaskKind,
  TaskKindSchema,
} from "./kinds.ts";
import { CHECK_TIER, type CheckTier } from "./manifests.ts";
import type { PlanPart, PlanResult } from "./plans.ts";
import { ProofSchema } from "./proofs.ts";
import { jsons } from "./utils.ts";

const UnprovenSchema = z.object({ part: z.string(), reason: z.string() });

/** The end statuses of `/tenbox-build`. */
export const BUILD_STATUS = {
  readyForYou: "ready-for-you",
  needsYou: "needs-you",
  failed: "failed",
  notApproved: "not-approved",
} as const;

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

export type BuildStatus = (typeof BUILD_STATUS)[keyof typeof BUILD_STATUS];

/** A part a reviewer found without a proof; `part` is the `NN` of the part file name. */
export type Unproven = z.infer<typeof UnprovenSchema>;

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

/** A plan without groups is one group at the full tier, unless its kind forces another. */
const UNGROUPED_TIER = CHECK_TIER.full;

/** The JSON args `tenbox build` sends to `/tenbox-build`. */
export interface BuildArgs {
  task: string;
  kind: TaskKind;
  /** How many rounds the build may review. */
  reviews: number;
  parts: PlanPart[];
  lenses: Lens[];
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

/** The kind a build runs as, its plan and the files its diff changed. */
export interface KindDiff extends KindPlan {
  files: DiffFile[];
}

/** `kind-raised` when the diff is over the limits of the kind, with the review of the kind it fits. */
export function assertKindFits(input: KindDiff): void {
  const { kind, plan, files } = input;
  const fitting = kindForDiff({ kind, files });
  if (fitting === kind) return;
  const { lenses } = reviewOf({ kind: fitting, lenses: plan?.lenses ?? [], tier: UNGROUPED_TIER });
  const reviews = KIND_PRESETS[fitting].reviews;
  const diff = { files: files.length, lines: diffLines(files) };
  throw kindRaisedError({ from: kind, kind: fitting, lenses, reviews, diff });
}
