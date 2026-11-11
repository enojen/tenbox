import { z } from "zod";
import { BUILD_STATUS } from "./builds.ts";
import { badFileError } from "./errors/index.ts";
import { BaselineSourceSchema } from "./failures.ts";
import { OOM_KILLED } from "./machines.ts";
import { PlanPartSchema } from "./plans.ts";
import { PR_STATE } from "./prs.ts";
import { jsons } from "./utils.ts";

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

export type Event = z.infer<typeof EventSchema>;

/** The id an event is about: its task, else its round, else its part. */
export function eventSubject(event: Event): string {
  if ("task" in event) return event.task;
  if ("round" in event) return event.round;
  return event.part;
}

/** A worker of the cluster came or went; only the server makes these, from its node watch. */
const NODE_EVENT_NAME = { added: "node.added", removed: "node.removed" } as const;

export const NODE_EVENT_NAMES = Object.values(NODE_EVENT_NAME);

/** A Hetzner price as its API gives it, e.g. `"0.0076"`: decimal text, so no float rounding. */
const PriceSchema = z.object({ net: text, gross: text });

const nodeBase = z.object({
  /** The Node name: the event's subject. */
  node: text,
  /** The Hetzner Cloud server id, from the Node's `hcloud://<id>` providerID. */
  server_id: z.number().int().positive(),
  server_type: text,
  location: text,
});

const NodeAddedSchema = nodeBase.extend({
  event: z.literal(NODE_EVENT_NAME.added),
  /** The hourly price of the server type in its location when the node came. */
  price_hourly: PriceSchema,
});

const NodeRemovedSchema = nodeBase.extend({
  event: z.literal(NODE_EVENT_NAME.removed),
  /** The node left while the server was down; `at` is then the server's start time. */
  late: z.boolean(),
});

/** Not part of `EventSchema`, so `POST /events` refuses them. */
const NodeEventSchema = z.discriminatedUnion("event", [NodeAddedSchema, NodeRemovedSchema]);

export type NodeEvent = z.infer<typeof NodeEventSchema>;
export type NodeAdded = z.infer<typeof NodeAddedSchema>;
type NodeRemoved = z.infer<typeof NodeRemovedSchema>;

/** A Node the cluster lists, with the Hetzner server behind it. */
export interface ListedNode {
  name: string;
  serverId: number;
}

/** The node events stored so far and the Nodes of one poll. */
interface NodeState {
  stored: NodeEvent[];
  listed: ListedNode[];
}

/** What one poll must store: the new items, and the added ones that are no longer listed. */
interface Changes<Added, Listed> {
  added: Listed[];
  removed: Added[];
}

type NodeChanges = Changes<NodeAdded, ListedNode>;

/** The key a watch matches an item by: one that is never reused. */
type PresenceKey = string | number;

/** The stored additions and removals of a watch, the items of one poll, and how to key both. */
interface Presence<Added, Listed> {
  added: Added[];
  removed: Set<PresenceKey>;
  listed: Listed[];
  addedKey: (event: Added) => PresenceKey;
  listedKey: (item: Listed) => PresenceKey;
}

/** One removal of an added node. */
interface NodeRemoval {
  added: NodeAdded;
  late: boolean;
}

/** One id per server and event, so a server that polls again stores nothing twice. */
export function nodeEventId(event: NodeEvent): string {
  return `${event.event}:${event.server_id}`;
}

const isAdded = (event: NodeEvent): event is NodeAdded => event.event === NODE_EVENT_NAME.added;

const removedServerIds = (stored: NodeEvent[]): Set<number> =>
  new Set(stored.filter((event) => !isAdded(event)).map((event) => event.server_id));

/** A listed item with no addition is new; an addition with no removal and no listed item is gone. */
function presenceChanges<Added, Listed>(presence: Presence<Added, Listed>): Changes<Added, Listed> {
  const { added, removed, listed, addedKey, listedKey } = presence;
  const addedKeys = new Set(added.map(addedKey));
  const listedKeys = new Set(listed.map(listedKey));
  return {
    added: listed.filter((item) => !addedKeys.has(listedKey(item))),
    removed: added.filter(
      (event) => !removed.has(addedKey(event)) && !listedKeys.has(addedKey(event)),
    ),
  };
}

/** Servers are matched by id: a server id is never reused, a Node name may be. */
export function nodeChanges(state: NodeState): NodeChanges {
  return presenceChanges({
    added: state.stored.filter(isAdded),
    removed: removedServerIds(state.stored),
    listed: state.listed,
    addedKey: (event) => event.server_id,
    listedKey: (node) => node.serverId,
  });
}

/** The workers that are up: a `node.added` whose server id has no `node.removed`. */
export function nodesUp(stored: NodeEvent[]): NodeAdded[] {
  const removedIds = removedServerIds(stored);
  return stored.filter(isAdded).filter((event) => !removedIds.has(event.server_id));
}

/** The type and location of a removed node come from its `node.added`. */
export function nodeRemoved(removal: NodeRemoval): NodeRemoved {
  const { added, late } = removal;
  return {
    event: NODE_EVENT_NAME.removed,
    node: added.node,
    server_id: added.server_id,
    server_type: added.server_type,
    location: added.location,
    late,
  };
}

/** A new node, priced from its Hetzner server. */
export function nodeAdded(node: NodeAddedFields): NodeAdded {
  return { event: NODE_EVENT_NAME.added, ...node };
}

/** A `node.added` without its event name. */
export type NodeAddedFields = Omit<NodeAdded, "event">;

/** The body of a stored node event; `bad-file` unless it fits `NodeEventSchema`. */
export function readNodeEvent(text: string, file: string): NodeEvent {
  const result = jsons.check(NodeEventSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}

/** A task volume of the cluster came or went; only the server makes these, from its volume watch. */
const VOLUME_EVENT_NAME = { added: "volume.added", removed: "volume.removed" } as const;

export const VOLUME_EVENT_NAMES = Object.values(VOLUME_EVENT_NAME);

/** A Kubernetes storage quantity: whole digits and a binary or decimal suffix (`10Gi`, `5G`). */
const STORAGE_PATTERN = /^([0-9]+)([KMGTPE]i|[kMGTPE])?$/;
const BINARY_SUFFIXES = ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei"];
const DECIMAL_SUFFIXES = ["k", "M", "G", "T", "P", "E"];
const BINARY_STEP = 1024n;
const DECIMAL_STEP = 1000n;
/** Hetzner's "GB" of a volume is a GiB. */
const GIB = suffixBytes("Gi");

const volumeBase = z.object({
  /** The PVC name: the event's subject. */
  volume: text,
  /** The PVC uid: a PVC name may come again. */
  uid: text,
  /** The PVC's `task` label. */
  task: text,
  /** `status.capacity.storage` in GiB, rounded up. */
  size_gb: count,
});

const VolumeAddedSchema = volumeBase.extend({
  event: z.literal(VOLUME_EVENT_NAME.added),
  /** The Hetzner price of one GB of volume for one month when the volume came. */
  price_per_gb_month: PriceSchema,
});

const VolumeRemovedSchema = volumeBase.extend({
  event: z.literal(VOLUME_EVENT_NAME.removed),
  /** The volume went while the server was down; `at` is then the server's start time. */
  late: z.boolean(),
});

/** Not part of `EventSchema`, so `POST /events` refuses them. */
const VolumeEventSchema = z.discriminatedUnion("event", [VolumeAddedSchema, VolumeRemovedSchema]);

export type VolumeEvent = z.infer<typeof VolumeEventSchema>;
export type VolumeAdded = z.infer<typeof VolumeAddedSchema>;
type VolumeRemoved = z.infer<typeof VolumeRemovedSchema>;
/** A Hetzner price, net and gross, as decimal text. */
export type Price = z.infer<typeof PriceSchema>;

/** A Bound task PVC the cluster lists. */
export interface ListedVolume {
  name: string;
  uid: string;
  task: string;
  /** The PVC's creationTimestamp, UTC. */
  created: string;
  /** `status.capacity.storage`, a Kubernetes quantity. */
  capacity: string;
}

/** The volume events stored so far and the volumes of one poll. */
interface VolumeState {
  stored: VolumeEvent[];
  listed: ListedVolume[];
}

/** One new volume and the price of a GB-month. */
export interface NewVolume {
  volume: ListedVolume;
  price: Price;
}

/** One removal of an added volume. */
interface VolumeRemoval {
  added: VolumeAdded;
  late: boolean;
}

/** One id per PVC and event, so a server that polls again stores nothing twice. */
export function volumeEventId(event: VolumeEvent): string {
  return `${event.event}:${event.uid}`;
}

const isVolumeAdded = (event: VolumeEvent): event is VolumeAdded =>
  event.event === VOLUME_EVENT_NAME.added;

const removedUids = (stored: VolumeEvent[]): Set<string> =>
  new Set(stored.filter((event) => !isVolumeAdded(event)).map((event) => event.uid));

/** Volumes are matched by PVC uid: a PVC name may come again. */
export function volumeChanges(state: VolumeState): Changes<VolumeAdded, ListedVolume> {
  return presenceChanges({
    added: state.stored.filter(isVolumeAdded),
    removed: removedUids(state.stored),
    listed: state.listed,
    addedKey: (event) => event.uid,
    listedKey: (volume) => volume.uid,
  });
}

export function volumesUp(stored: VolumeEvent[]): VolumeAdded[] {
  const removed = removedUids(stored);
  return stored.filter(isVolumeAdded).filter((event) => !removed.has(event.uid));
}

/** A new volume, sized in GiB from its capacity; `bad-file` for a capacity that is not a quantity. */
export function volumeAdded(input: NewVolume): VolumeAdded {
  const { volume, price } = input;
  return {
    event: VOLUME_EVENT_NAME.added,
    volume: volume.name,
    uid: volume.uid,
    task: volume.task,
    size_gb: capacityGib(volume),
    price_per_gb_month: price,
  };
}

/** The name, task and size of a removed volume come from its `volume.added`. */
export function volumeRemoved(removal: VolumeRemoval): VolumeRemoved {
  const { added, late } = removal;
  return {
    event: VOLUME_EVENT_NAME.removed,
    volume: added.volume,
    uid: added.uid,
    task: added.task,
    size_gb: added.size_gb,
    late,
  };
}

/** The body of a stored volume event; `bad-file` unless it fits `VolumeEventSchema`. */
export function readVolumeEvent(text: string, file: string): VolumeEvent {
  const result = jsons.check(VolumeEventSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}

function capacityGib(volume: ListedVolume): number {
  const match = STORAGE_PATTERN.exec(volume.capacity);
  if (match === null) {
    throw badFileError(`status.capacity.storage of ${volume.name}`, [
      `not a quantity: ${volume.capacity}`,
    ]);
  }
  const bytes = BigInt(match[1] ?? "") * suffixBytes(match[2] ?? "");
  return Number((bytes + GIB - 1n) / GIB);
}

function suffixBytes(suffix: string): bigint {
  const binary = BINARY_SUFFIXES.indexOf(suffix);
  if (binary >= 0) return BINARY_STEP ** BigInt(binary + 1);
  return DECIMAL_STEP ** BigInt(DECIMAL_SUFFIXES.indexOf(suffix) + 1);
}

/** The box container of a Job pod ended, or its pod went before it did; only the server makes it, from its Job watch. */
export const JOB_FINISHED = "job.finished";

/** The CPU and memory the box container asked for, as Kubernetes gives them (`500m`, `2Gi`). */
const RequestsSchema = z.object({ cpu: nullableText, memory: nullableText });

/** Not part of `EventSchema`, so `POST /events` refuses it. */
export const JobFinishedSchema = z.object({
  event: z.literal(JOB_FINISHED),
  task: text,
  /** `TENBOX_PROJECT` of the box: the project name. */
  project: nullableText,
  job: nullableText,
  pod: text,
  /** `TENBOX_CMD` of the box. */
  command: nullableText,
  /** The resource class. */
  class: nullableText,
  node: nullableText,
  /** Null when the pod went before its box container ended. */
  exit_code: z.number().int().nullable(),
  oom: z.boolean(),
  created: dateTime,
  scheduled: dateTime.nullable(),
  started: dateTime.nullable(),
  finished: dateTime,
  /** From `started` to `finished`; null when the box never started. */
  duration_ms: z.number().int().nullable(),
  requests: RequestsSchema,
});

export type JobFinished = z.infer<typeof JobFinishedSchema>;
type PodRequests = z.infer<typeof RequestsSchema>;

/** How the box container of a pod ended, from its terminated state. */
export interface BoxEnd {
  exitCode: number;
  /** `OOMKilled`, `Error`, `Completed`; null without one. */
  reason: string | null;
  finished: string;
}

/** A pod of a Job of the namespace `tenbox`, as far as its `job.finished` needs it. */
export interface ListedPod {
  uid: string;
  name: string;
  job: string | null;
  task: string;
  project: string | null;
  command: string | null;
  class: string | null;
  node: string | null;
  created: string;
  scheduled: string | null;
  /** When the box container started; null before it did. */
  started: string | null;
  /** Null while the box container runs or waits. */
  end: BoxEnd | null;
  requests: PodRequests;
}

/** The pods of the last poll whose event is not stored, the ids stored so far, and the pods of this poll. */
interface JobState {
  seen: ListedPod[];
  stored: Set<string>;
  listed: ListedPod[];
}

/** What one poll must store: the ended pods, and the pods that went before they ended. */
interface JobChanges {
  ended: ListedPod[];
  gone: ListedPod[];
}

/** One pod's event: whether its boot log says OOM, and the poll time for a pod that went. */
export interface JobFinishInput {
  pod: ListedPod;
  oomInLog: boolean;
  at: string;
}

/** One id per pod, so a server that polls again stores nothing twice. */
export function jobEventId(pod: ListedPod): string {
  return `${JOB_FINISHED}:${pod.uid}`;
}

/** Pods are matched by uid: a pod name may come again. */
export function jobChanges(state: JobState): JobChanges {
  const isNew = (pod: ListedPod) => !state.stored.has(jobEventId(pod));
  const listedUids = new Set(state.listed.map((pod) => pod.uid));
  return {
    ended: state.listed.filter((pod) => pod.end !== null && isNew(pod)),
    gone: state.seen.filter((pod) => !listedUids.has(pod.uid) && isNew(pod)),
  };
}

/** A pod without a box end went before it ended: no exit code, and the poll time as `finished`. */
export function jobFinished(input: JobFinishInput): JobFinished {
  const { pod, oomInLog, at } = input;
  const finished = pod.end?.finished ?? at;
  return {
    event: JOB_FINISHED,
    task: pod.task,
    project: pod.project,
    job: pod.job,
    pod: pod.name,
    command: pod.command,
    class: pod.class,
    node: pod.node,
    exit_code: pod.end?.exitCode ?? null,
    oom: pod.end?.reason === OOM_KILLED || oomInLog,
    created: pod.created,
    scheduled: pod.scheduled,
    started: pod.started,
    finished,
    duration_ms: pod.started === null ? null : Date.parse(finished) - Date.parse(pod.started),
    requests: pod.requests,
  };
}

/** The body of a stored `job.finished`; `bad-file` unless it fits its schema. */
export function readJobFinished(text: string, file: string): JobFinished {
  const result = jsons.check(JobFinishedSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}

/** What `tenbox close` printed once it ended with exit code 0; only the server makes it, from its Job watch. */
export const CLOSE_OUTPUT = "close.output";

const CLOSE_COMMAND = "close";
const OBJECT_START = "{";
const OBJECT_END = "}";

/** Not part of `EventSchema`, so `POST /events` refuses it; the rest of the close output is kept as it came. */
const CloseOutputSchema = z.looseObject({ ok: z.literal(true), task: text });

export type CloseOutput = z.infer<typeof CloseOutputSchema>;

/** One id per pod, so a server that polls again stores nothing twice. */
export function closeOutputId(pod: ListedPod): string {
  return `${CLOSE_OUTPUT}:${pod.uid}`;
}

/** A `tenbox close` pod (the second word of `TENBOX_CMD`) whose box ended with exit code 0. */
export function isClosed(pod: ListedPod): boolean {
  const word = pod.command?.trim().split(/\s+/)[1];
  return word === CLOSE_COMMAND && pod.end?.exitCode === 0;
}

/**
 * The last top-level JSON object of a box log, from a `{` line up to the next `}` line at
 * column 0 (as `tenbox close` prints it); null when there is none or it is not `{ ok: true, task }`.
 */
export function closeOutput(log: string): CloseOutput | null {
  const lines = log.split("\n");
  const end = lines.lastIndexOf(OBJECT_END);
  const start = lines.slice(0, end).lastIndexOf(OBJECT_START);
  if (start < 0 || end < 0) return null;
  const result = jsons.check(CloseOutputSchema, lines.slice(start, end + 1).join("\n"));
  return result.ok ? result.value : null;
}

/** A notice the server sent about an idle open task volume; only the server makes it, from its volume watch. */
export const VOLUME_IDLE = "volume.idle";

const DAY_MS = 86_400_000;
/** An open task volume with no run for this many days gets one notice. */
const IDLE_DAYS = 7;

/** One live volume, what its task did, and the rules it goes by. */
export interface VolumeCheck {
  volume: ListedVolume;
  /** The `at` of the newest `close.output` of the volume's task; null when it has none. */
  closedAt: string | null;
  /** The `job.finished` bodies of the volume's task. */
  runs: JobFinished[];
  now: Date;
  /** The days a closed task's volume stays after its close. */
  graceDays: number;
}

/** A closed task's volume whose grace period is over. */
interface VolumeDeletion {
  action: "delete";
  volume: ListedVolume;
}

/** An open task's volume with no run for `IDLE_DAYS` or more. */
export interface VolumeNotice {
  action: "notify";
  volume: ListedVolume;
  /** `TENBOX_PROJECT` of the newest run that has one, else the volume name. */
  project: string;
  /** The newest run end, or the volume's creation when that is newer: the start of the idle stretch. */
  since: string;
  days: number;
}

export type VolumeAction = VolumeDeletion | VolumeNotice;

/** What identifies one notice: the volume and the start of its idle stretch. */
type NoticeKey = Pick<VolumeNotice, "volume" | "since">;

/** The body of a stored `volume.idle`; not part of `EventSchema`, so `POST /events` refuses it. */
export interface VolumeIdle {
  event: typeof VOLUME_IDLE;
  volume: string;
  uid: string;
  task: string;
  since: string;
  days: number;
}

/**
 * A volume is closed when its task has a close newer than the volume and no run created after
 * it; else it is open. Null when nothing is due: a closed one inside its grace period, an open one
 * with a run in the last `IDLE_DAYS` days.
 */
export function volumeAction(check: VolumeCheck): VolumeAction | null {
  const { volume, closedAt, now } = check;
  if (closedAt !== null && isClosedVolume(check, closedAt)) {
    const over = now.getTime() - Date.parse(closedAt) >= check.graceDays * DAY_MS;
    return over ? { action: "delete", volume } : null;
  }
  const since = idleSince(check);
  const days = Math.floor((now.getTime() - Date.parse(since)) / DAY_MS);
  if (days < IDLE_DAYS) return null;
  return { action: "notify", volume, project: runProject(check), since, days };
}

function isClosedVolume(check: VolumeCheck, closedAt: string): boolean {
  const closed = Date.parse(closedAt);
  if (Date.parse(check.volume.created) > closed) return false;
  return check.runs.every((run) => Date.parse(run.created) <= closed);
}

function idleSince(check: VolumeCheck): string {
  const times = [check.volume.created, ...check.runs.map((run) => run.finished)];
  return times.reduce((newest, time) => (Date.parse(time) > Date.parse(newest) ? time : newest));
}

function runProject(check: VolumeCheck): string {
  const newestFirst = [...check.runs].sort(
    (a, b) => Date.parse(b.finished) - Date.parse(a.finished),
  );
  return newestFirst.find((run) => run.project !== null)?.project ?? check.volume.name;
}

/** One id per volume and idle stretch, so a notice is sent once until a new run ends. */
export function volumeIdleId(notice: NoticeKey): string {
  return `${VOLUME_IDLE}:${notice.volume.uid}:${notice.since}`;
}

export function volumeIdle(notice: VolumeNotice): VolumeIdle {
  const { volume, since, days } = notice;
  return {
    event: VOLUME_IDLE,
    volume: volume.name,
    uid: volume.uid,
    task: volume.task,
    since,
    days,
  };
}
