import { z } from "zod";
import { BUILD_STATUS } from "./build.ts";
import { BaselineSourceSchema } from "./failures.ts";
import { PlanPartSchema } from "./plan.ts";
import { PR_STATE } from "./pr.ts";

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

const text = z.string().min(1);
const count = z.number().int().nonnegative();
const nullableText = text.nullable();
const nullableCount = count.nullable();
const dateTime = z.iso.datetime();
/** The SHA-256 of `plan.md` in hex: when `plan.done` and `plan.approved` differ, the plan was changed by hand. */
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
  taskEvent("task.started").extend({
    project: text,
    title: nullableText,
    tracker: text,
    url: nullableText,
    branch: text,
    base: z.object({ ref: text, sha: text }),
  }),
  taskEvent("plan.started").extend({ deep: z.boolean() }),
  taskEvent("plan.done").extend({
    plan_sha: planSha,
    estimated_lines: count,
    parts: z.array(PlanPartSchema),
    criteria: count,
    questions: z.object({ total: count, blocking: count }),
    lenses: z.array(z.enum(["security", "contract"])),
  }),
  taskEvent("plan.approved").extend({ plan_sha: planSha }),
  taskEvent("build.started").extend({ max_rounds: count }),
  taskEvent("build.done").extend({
    status: z.enum(BUILD_DONE_STATUS),
    rounds: count,
  }),
  taskEvent("feedback.sent").extend({
    round: text,
    from: z.enum(FEEDBACK_FROM),
    must_fix: count,
  }),
  base.extend({ event: z.literal("round.started"), round: text }),
  base.extend({
    event: z.literal("round.checked"),
    round: text,
    commit: text,
    ok: z.boolean(),
    checks: z.array(CheckSchema),
  }),
  base.extend({
    event: z.literal("round.reviewed"),
    round: text,
    must_fix: count,
    nice_to_have: count,
    attention: count,
    unproven: z.array(z.object({ part: text, reason: z.string() })),
  }),
  base.extend({
    event: z.literal("proof.added"),
    part: text,
    file: text,
    test: text,
    failure: z.string(),
    source: z.enum(PROOF_SOURCE),
  }),
  taskEvent("workflow.done").extend({
    workflow: text,
    run: text,
    agents: z.array(AgentSchema),
  }),
  taskEvent("pr.saved").extend({
    number: count,
    url: text,
    state: z.enum(PR_STATE),
    draft: z.boolean(),
  }),
  taskEvent("pr.merged").extend({ number: count }),
  taskEvent("task.closed").extend({
    forced: z.boolean(),
    code: z.object({ added: count, removed: count, files: count, test_added: count }),
  }),
]);

type TenboxEvent = z.infer<typeof EventSchema>;
export type EventName = TenboxEvent["event"];
