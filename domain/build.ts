import path from "node:path";
import { z } from "zod";
import { answeredError, badBuildError, noDecisionError } from "./errors/tasks.ts";
import { usageError } from "./errors/usage.ts";
import { ProofSchema } from "./proof.ts";
import { isFilled, issueLines, parseObject } from "./utils.ts";

/** `build.json` in a `.tenbox/` folder: the last build result. */
export const buildFile = (dir: string): string => path.join(dir, "build.json");

/** One line: the card goes into a `decisions.md` bullet and a notification line. */
const oneLine = z
  .string()
  .refine(isFilled, "must not be blank")
  .refine((text) => !text.includes("\n"), "must be one line");

const UnprovenSchema = z.object({ part: z.string(), reason: z.string() });

/** The end statuses of `/tenbox-build`. */
export const BUILD_STATUS = {
  readyForYou: "ready-for-you",
  needsYou: "needs-you",
  failed: "failed",
  notApproved: "not-approved",
} as const;

/** What a blocked worker asks; `recommended` is the 1-based number of one of the options. */
const DecisionCardSchema = z
  .object({
    title: oneLine,
    options: z.array(oneLine).min(1),
    recommended: z.number().int().positive(),
    reason: z.string(),
    auto: z.boolean(),
  })
  .refine((card) => card.recommended <= card.options.length, {
    message: "must be the number of one of the options",
    path: ["recommended"],
  });

/** How a card was answered: the 1-based option, when, and whether no person chose it. */
const AnsweredSchema = z.object({
  option: z.number().int().positive(),
  at: z.string(),
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
  /** When the recommended option is taken; null when the card has no `auto`. */
  deadline: z.string().nullable().optional(),
  answered: AnsweredSchema.optional(),
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

/** The build result in the text; `bad-build` when it is not a JSON object or does not match. */
export function parseBuild(text: string): BuildResult {
  const parsed = BuildResultSchema.safeParse(parseObject(text));
  if (!parsed.success) throw badBuildError(issueLines(parsed.error));
  return parsed.data;
}

/** The build result in the text; null when it is not valid. */
export function readBuild(text: string): BuildResult | null {
  const parsed = BuildResultSchema.safeParse(parseObject(text));
  return parsed.success ? parsed.data : null;
}

/** 30 minutes: a card with `auto` waits this long for a person. */
const AUTO_ANSWER_MS = 1_800_000;

/** The card's `deadline`: `now` + 30 minutes with `auto`, else null; no key without a card. */
export function addDeadline(result: BuildResult, now: Date): BuildResult {
  const { decision } = result;
  if (decision === undefined) return result;
  const deadline = decision.auto ? new Date(now.getTime() + AUTO_ANSWER_MS).toISOString() : null;
  return { ...result, deadline };
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
