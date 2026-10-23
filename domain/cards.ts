import { z } from "zod";
import { noCardError } from "./errors/cards.ts";
import { badFileError } from "./errors/index.ts";
import { GroupSchema } from "./groups.ts";
import { LensSchema, TaskKindSchema } from "./kinds.ts";
import { TrackerKindSchema } from "./manifests.ts";
import { ExampleSchema, PlanPartSchema } from "./plans.ts";
import { jsons, strings } from "./utils.ts";

/*
 * A card: one record of a task under `cards/`, numbered in order. Cards are added, never
 * changed: an answer is a new card with `replyTo`. The valid state of a question is the
 * question plus the newest answer to it. The `.json` holds what the code reads; a task or
 * plan card also has a `.md` with its long text, which no code parses.
 */

const positive = z.number().int().positive();
const filled = z.string().refine(strings.isNotBlank, "must not be blank");
/** One line: a title goes into a notification line. */
const oneLine = filled.refine((text) => !text.includes("\n"), "must be one line");

const CARD_KIND = {
  task: "task",
  plan: "plan",
  question: "question",
  answer: "answer",
  note: "note",
  approval: "approval",
  review: "review",
} as const;

export type CardKind = (typeof CARD_KIND)[keyof typeof CARD_KIND];

/** Who writes a card: `by`. An auto answer is by tenbox. */
const AUTHOR = {
  tenbox: "tenbox",
  planner: "planner",
  worker: "worker",
  reviewer: "reviewer",
  user: "user",
} as const;

/** What a question is about; the planner and the worker pick the closest area. */
export const QUESTION_AREA = [
  "technical",
  "product",
  "contract",
  "risk",
  "migration",
  "data-delete",
  "feature-delete",
  "paid-service",
  "locked-file",
  "scope",
  "other",
] as const;

export type QuestionArea = (typeof QUESTION_AREA)[number];

/** Areas Tenbox never auto-answers, whatever `auto` says. */
export const NEVER_AUTO_AREAS: readonly QuestionArea[] = [
  "migration",
  "data-delete",
  "feature-delete",
  "contract",
  "paid-service",
  "locked-file",
];

/** What every card has. */
const BaseSchema = z.object({
  id: positive,
  by: z.enum(AUTHOR),
  at: z.iso.datetime(),
});

/** Written by `tenbox start`; the `.md` holds the description and the tracker comments. */
const TaskCardSchema = BaseSchema.extend({
  kind: z.literal(CARD_KIND.task),
  task: filled,
  title: filled,
  tracker: TrackerKindSchema,
  url: z.string().nullable(),
  /** Set by `tenbox start --kind`; it wins over the planner's kind. */
  taskKind: TaskKindSchema.optional(),
});

/** Written by `tenbox plan done`; the `.md` holds the planner's plan text. */
const PlanCardSchema = BaseSchema.extend({
  kind: z.literal(CARD_KIND.plan),
  taskKind: TaskKindSchema,
  parts: z.array(PlanPartSchema),
  examples: z.array(ExampleSchema),
  lenses: z.array(LensSchema),
  groups: z.array(GroupSchema),
  /** The ids of this plan's question cards. */
  questions: z.array(positive),
});

/** One choice of a question: what it is and what happens when it is taken. */
const OptionSchema = z.object({ text: oneLine, effect: oneLine });

/**
 * Someone asks for a choice or for information: the planner with `taken`, the worker without
 * it (`round`, `part`, `auto`), the user from a PR thread (`path`, `line`, `thread`).
 */
const QuestionCardSchema = BaseSchema.extend({
  kind: z.literal(CARD_KIND.question),
  title: oneLine,
  area: z.enum(QUESTION_AREA),
  /** In the asker's order of preference; missing when the asker needs information. */
  options: z.array(OptionSchema).min(1).optional(),
  /** The option the asker took, counted from 1; only the planner and the user take one. */
  taken: positive.optional(),
  /** Why the asker took it, or why it could not. */
  reason: z.string().optional(),
  round: positive.optional(),
  part: filled.optional(),
  group: positive.optional(),
  path: filled.optional(),
  line: positive.optional(),
  thread: positive.optional(),
  /** True when the build may go on with the first option after the deadline. */
  auto: z.boolean().optional(),
  /** When the auto answer is taken; set by tenbox when `auto` and the area allow it. */
  deadline: z.iso.datetime().optional(),
}).superRefine((question, ctx) => {
  const count = question.options?.length ?? 0;
  if (question.taken !== undefined && question.taken > count) {
    ctx.addIssue({
      code: "custom",
      path: ["taken"],
      message: `must be the number of one of the ${count} options`,
    });
  }
  if (question.deadline !== undefined && question.auto !== true) {
    ctx.addIssue({ code: "custom", path: ["deadline"], message: "needs auto: true" });
  }
});

/** A reply to a question: one of its options, or a text outside them. */
const AnswerCardSchema = BaseSchema.extend({
  kind: z.literal(CARD_KIND.answer),
  replyTo: positive,
  option: positive.optional(),
  text: z.string().optional(),
  /** True when no person chose it: the deadline passed. */
  auto: z.boolean().optional(),
}).refine((answer) => answer.option !== undefined || answer.text !== undefined, {
  message: "needs an option or a text",
  path: ["option"],
});

/** Information, not an answer; every agent reads it. */
const NoteCardSchema = BaseSchema.extend({
  kind: z.literal(CARD_KIND.note),
  text: filled,
});

/** "Go on with this": tied to a plan card or a review card; `sha` is of that card's text. */
const ApprovalCardSchema = BaseSchema.extend({
  kind: z.literal(CARD_KIND.approval),
  replyTo: positive,
  sha: filled,
});

/** An unproven change of behaviour: the part and why the reviewer saw no proof. */
const UnprovenSchema = z.object({ part: filled, reason: filled });

/** What the reviewers found in one round, the lenses merged; written by `tenbox review done`. */
const AgentReviewCardSchema = BaseSchema.extend({
  kind: z.literal(CARD_KIND.review),
  by: z.literal(AUTHOR.reviewer),
  round: positive,
  lenses: z.array(LensSchema),
  group: positive.optional(),
  /** Needed by the plan, the spec or correctness; a next round when not empty. */
  mustFix: z.array(filled),
  /** At most three; does not block. */
  niceToHave: z.array(filled),
  /** The hunks a person must read. */
  attention: z.array(filled),
  unproven: z.array(UnprovenSchema),
});

/** The user's comments on a PR, one question card per thread; written by `tenbox feedback`. */
const UserReviewCardSchema = BaseSchema.extend({
  kind: z.literal(CARD_KIND.review),
  by: z.literal(AUTHOR.user),
  round: positive,
  pr: positive.optional(),
  questions: z.array(positive),
});

const ReviewCardSchema = z.discriminatedUnion("by", [AgentReviewCardSchema, UserReviewCardSchema]);

const CardSchema = z.discriminatedUnion("kind", [
  TaskCardSchema,
  PlanCardSchema,
  QuestionCardSchema,
  AnswerCardSchema,
  NoteCardSchema,
  ApprovalCardSchema,
  ReviewCardSchema,
]);

export type Card = z.infer<typeof CardSchema>;
export type QuestionCard = z.infer<typeof QuestionCardSchema>;
export type AnswerCard = z.infer<typeof AnswerCardSchema>;

/** The card of one kind. */
export type CardOf<K extends CardKind> = Extract<Card, { kind: K }>;

/** The card in the text of its `.json`; `bad-file` when it is not JSON or does not match. */
export function readCard(text: string, file: string): Card {
  const result = jsons.check(CardSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}

/** The card with that id; null when there is none. */
export function findCard(cards: Card[], id: number): Card | null {
  return cards.find((card) => card.id === id) ?? null;
}

/** The card with that id; `no-card` when there is none. */
export function getCard(cards: Card[], id: number): Card {
  const card = findCard(cards, id);
  if (card === null) throw noCardError(id);
  return card;
}

/** The card of that kind with the largest id; null when there is none. */
export function findNewest<K extends CardKind>(cards: Card[], kind: K): CardOf<K> | null {
  const ofKind = cards.filter((card): card is CardOf<K> => card.kind === kind);
  return ofKind.reduce<CardOf<K> | null>(
    (newest, card) => (newest === null || card.id > newest.id ? card : newest),
    null,
  );
}

/** The newest answer to that question; null when nobody answered. */
export function findAnswer(cards: Card[], question: QuestionCard): AnswerCard | null {
  const answers = cards.filter(
    (card): card is AnswerCard => card.kind === CARD_KIND.answer && card.replyTo === question.id,
  );
  return answers.reduce<AnswerCard | null>(
    (newest, answer) => (newest === null || answer.id > newest.id ? answer : newest),
    null,
  );
}

/** The option that counts, from 1: the newest answer's, else the asker's `taken`; null for none. */
export function chosenOption(cards: Card[], question: QuestionCard): number | null {
  const answer = findAnswer(cards, question);
  if (answer !== null) return answer.option ?? null;
  return question.taken ?? null;
}

/** True when the question has no `taken` and no answer: it blocks the approval or the build. */
export function isOpen(cards: Card[], question: QuestionCard): boolean {
  return question.taken === undefined && findAnswer(cards, question) === null;
}

/** True when the question has `auto` and its area is not never-auto. */
export function canAutoAnswer(question: QuestionCard): boolean {
  return question.auto === true && !NEVER_AUTO_AREAS.includes(question.area);
}

/** The id of the next card: the largest id plus one, 1 for the first. */
export function nextCardId(cards: Card[]): number {
  return cards.reduce((largest, card) => Math.max(largest, card.id), 0) + 1;
}
