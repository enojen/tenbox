import { z } from "zod";
import { type DiffFile, diffLines } from "./diffs.ts";
import { CHECK_TIER, type CheckTier } from "./manifests.ts";

/* A task kind: a named preset of the review depth, the check tier and the diff limits. */

/** From the shortest flow to the longest; `kindForDiff` relies on this order. */
export const TASK_KINDS = ["docs", "small", "normal", "large"] as const;

export const TaskKindSchema = z.enum(TASK_KINDS);

export type TaskKind = z.infer<typeof TaskKindSchema>;

/** The kind of a plan that names none. */
export const DEFAULT_KIND: TaskKind = "normal";

/** The review lenses a plan or a group may ask for; a kind may add them all. */
export const LensSchema = z.enum(["security", "contract"]);

type Lens = z.infer<typeof LensSchema>;

/** `none`: no extra lens; `own`: the lenses of the plan or group; `every`: all lenses. */
type LensRule = "none" | "own" | "every";

/** `own` keeps the tier of the plan or group; the others force that tier. */
type TierRule = CheckTier | "own";

/** What a diff may hold to keep its kind; null is no limit. */
interface KindLimits {
  files: number | null;
  lines: number | null;
  markdownOnly: boolean;
}

interface KindPreset {
  reviews: number;
  lenses: LensRule;
  tier: TierRule;
  limits: KindLimits;
}

const MAX_REVIEWS = 3;
const SMALL_FILES = 5;
const SMALL_LINES = 100;
const NORMAL_FILES = 20;
const NORMAL_LINES = 400;

const NO_LIMIT: KindLimits = { files: null, lines: null, markdownOnly: false };

export const KIND_PRESETS: Record<TaskKind, KindPreset> = {
  docs: {
    reviews: 1,
    lenses: "none",
    tier: CHECK_TIER.fast,
    limits: { ...NO_LIMIT, markdownOnly: true },
  },
  small: {
    reviews: 1,
    lenses: "none",
    tier: CHECK_TIER.fast,
    limits: { files: SMALL_FILES, lines: SMALL_LINES, markdownOnly: false },
  },
  normal: {
    reviews: MAX_REVIEWS,
    lenses: "own",
    tier: "own",
    limits: { files: NORMAL_FILES, lines: NORMAL_LINES, markdownOnly: false },
  },
  large: {
    reviews: MAX_REVIEWS,
    lenses: "every",
    tier: CHECK_TIER.full,
    limits: NO_LIMIT,
  },
};

/** The kind and the lenses and tier a plan or group asks for itself. */
export interface ReviewInput {
  kind: TaskKind;
  lenses: Lens[];
  tier: CheckTier;
}

/** The lenses, check tier and review rounds a build runs. */
export interface KindReview {
  lenses: Lens[];
  tier: CheckTier;
  reviews: number;
}

const LENSES_BY_RULE: Record<LensRule, (own: Lens[]) => Lens[]> = {
  none: () => [],
  own: (own) => own,
  every: () => [...LensSchema.options],
};

/** The review of a kind over a plan or group. */
export function reviewOf(input: ReviewInput): KindReview {
  const { kind, lenses, tier } = input;
  const preset = KIND_PRESETS[kind];
  return {
    lenses: LENSES_BY_RULE[preset.lenses](lenses),
    tier: preset.tier === "own" ? tier : preset.tier,
    reviews: preset.reviews,
  };
}

/** The kind a build was given and the files its diff changed. */
export interface DiffInput {
  kind: TaskKind;
  files: DiffFile[];
}

const isMarkdown = (file: DiffFile): boolean => file.path.toLowerCase().endsWith(".md");

function fits(files: DiffFile[], limits: KindLimits): boolean {
  if (limits.markdownOnly && !files.every(isMarkdown)) return false;
  if (limits.files !== null && files.length > limits.files) return false;
  return limits.lines === null || diffLines(files) <= limits.lines;
}

/** The smallest kind whose limits the diff fits, never below the given kind; `large` fits all. */
export function kindForDiff(input: DiffInput): TaskKind {
  const { kind, files } = input;
  const candidates = TASK_KINDS.slice(TASK_KINDS.indexOf(kind));
  return candidates.find((candidate) => fits(files, KIND_PRESETS[candidate].limits)) ?? "large";
}
