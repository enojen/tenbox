import { z } from "zod";
import { BUILD_STATUS } from "./builds.ts";
import { BaselineSourceSchema } from "./failures.ts";
import { PlanPartSchema } from "./plans.ts";
import { PR_STATE } from "./prs.ts";

const EVENT_SCHEMA_VERSION = 1;

/** How `/tenbox-build` ended; `ready` is the `ready-for-you` build status. */
const BUILD_DONE_STATUS = {
  ready: "ready",
  failed: BUILD_STATUS.failed,
  needsYou: BUILD_STATUS.needsYou,
} as const;

/** Who sent the feedback of a round. */
const FEEDBACK_FROM = { auto: "auto", human: "human" } as const;

/** Who recorded a proof: the build or `tenbox proof`. */
const PROOF_SOURCE = { worker: "worker", manual: "manual" } as const;

/** The name of every event. */
const EVENT_NAME = {
  taskStarted: "task.started",
  planStarted: "plan.started",
  planDone: "plan.done",
  planApproved: "plan.approved",
  buildStarted: "build.started",
  buildDone: "build.done",
  feedbackSent: "feedback.sent",
  roundStarted: "round.started",
  roundChecked: "round.checked",
  roundReviewed: "round.reviewed",
  proofAdded: "proof.added",
  workflowDone: "workflow.done",
  prSaved: "pr.saved",
  prMerged: "pr.merged",
  taskClosed: "task.closed",
} as const;

export type EventName = (typeof EVENT_NAME)[keyof typeof EVENT_NAME];

const text = z.string().min(1);
const count = z.number().int().nonnegative();
const nullableText = text.nullable();
const nullableCount = count.nullable();
const dateTime = z.iso.datetime();
/** The SHA-256 of `plan.json` in hex: when `plan.done` and `plan.approved` differ, the plan was changed by hand. */
const planSha = z.string().regex(/^[0-9a-f]{64}$/);

const base = z.object({
  id: text,
  schema: z.literal(EVENT_SCHEMA_VERSION),
  user: text,
  tenbox: text,
  at: dateTime,
  sent_at: dateTime,
});

const taskEvent = <N extends string>(event: N) =>
  base.extend({ event: z.literal(event), task: text });

const CheckSchema = z.object({
  id: text,
  exit_code: z.number().int(),
  duration_ms: count,
  timed_out: z.boolean(),
  failures: count,
  new_failures: count,
  fixed: count,
  baseline: z.object({ sha: nullableText, source: BaselineSourceSchema }),
});

const AgentSchema = z.object({
  role: text,
  label: nullableText,
  round: nullableCount,
  model: nullableText,
  started: dateTime.nullable(),
  seconds: nullableCount,
  tokens: nullableCount,
  tool_calls: nullableCount,
});

export const EventSchema = z.discriminatedUnion("event", [
  taskEvent(EVENT_NAME.taskStarted).extend({
    project: text,
    title: nullableText,
    tracker: text,
    url: nullableText,
    branch: text,
    base: z.object({ ref: text, sha: text }),
  }),
  taskEvent(EVENT_NAME.planStarted).extend({ deep: z.boolean() }),
  taskEvent(EVENT_NAME.planDone).extend({
    plan_sha: planSha,
    estimated_lines: count,
    parts: z.array(PlanPartSchema),
    examples: count,
    questions: z.object({ total: count, blocking: count }),
    lenses: z.array(z.enum(["security", "contract"])),
  }),
  taskEvent(EVENT_NAME.planApproved).extend({ plan_sha: planSha }),
  taskEvent(EVENT_NAME.buildStarted).extend({ max_rounds: count }),
  taskEvent(EVENT_NAME.buildDone).extend({
    status: z.enum(BUILD_DONE_STATUS),
    rounds: count,
  }),
  taskEvent(EVENT_NAME.feedbackSent).extend({
    round: text,
    from: z.enum(FEEDBACK_FROM),
    must_fix: count,
  }),
  base.extend({ event: z.literal(EVENT_NAME.roundStarted), round: text }),
  base.extend({
    event: z.literal(EVENT_NAME.roundChecked),
    round: text,
    commit: text,
    ok: z.boolean(),
    checks: z.array(CheckSchema),
  }),
  base.extend({
    event: z.literal(EVENT_NAME.roundReviewed),
    round: text,
    must_fix: count,
    nice_to_have: count,
    attention: count,
    unproven: z.array(z.object({ part: text, reason: z.string() })),
  }),
  base.extend({
    event: z.literal(EVENT_NAME.proofAdded),
    part: text,
    file: text,
    test: text,
    failure: z.string(),
    source: z.enum(PROOF_SOURCE),
  }),
  taskEvent(EVENT_NAME.workflowDone).extend({
    workflow: text,
    run: text,
    agents: z.array(AgentSchema),
  }),
  taskEvent(EVENT_NAME.prSaved).extend({
    number: count,
    url: text,
    state: z.enum(PR_STATE),
    draft: z.boolean(),
  }),
  taskEvent(EVENT_NAME.prMerged).extend({ number: count }),
  taskEvent(EVENT_NAME.taskClosed).extend({
    forced: z.boolean(),
    code: z.object({ added: count, removed: count, files: count, test_added: count }),
  }),
]);
