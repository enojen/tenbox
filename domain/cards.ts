import { z } from "zod";
import { usageError } from "./errors/usage.ts";
import { strings } from "./utils.ts";

/* A decision card: what a blocked worker asks a person, saved in `build.json` with `needs-you`. */

/** One line: the card goes into a `decisions.md` bullet and a notification line. */
const oneLine = z
  .string()
  .refine(strings.isNotBlank, "must not be blank")
  .refine((text) => !text.includes("\n"), "must be one line");

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

export type CardKind = (typeof CARD_KIND)[number];

/** What a blocked worker asks; `recommended` is the 1-based number of one of the options. */
export const DecisionCardSchema = z
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
export const AnsweredSchema = z.object({
  option: z.number().int().positive(),
  at: z.iso.datetime(),
  auto: z.boolean(),
});

export type DecisionCard = z.infer<typeof DecisionCardSchema>;

/** Kinds Tenbox never auto-answers, whatever `auto` says. */
const NEVER_AUTO: readonly CardKind[] = CARD_KIND.filter(
  (kind) => kind !== "scope" && kind !== "other",
);

/** True when the card has `auto` and its kind is not never-auto. */
export function isAutoAllowed(card: DecisionCard): boolean {
  return card.auto && !NEVER_AUTO.includes(card.kind);
}

/** The text of the 1-based option; `usage` when the card has no such option. */
export function getOption(card: DecisionCard, option: number): string {
  const text = card.options[option - 1];
  if (!Number.isInteger(option) || text === undefined) {
    throw usageError(`option must be a number from 1 to ${card.options.length}`);
  }
  return text;
}
