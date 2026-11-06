import { z } from "zod";
import { badFileError } from "./errors/index.ts";
import type { JobFinished, NodeAdded, NodeEvent } from "./events.ts";

const MS_PER_HOUR = 3_600_000;
const CENTS_PER_EUR = 100n;
const DECIMAL_BASE = 10n;
const CENT_DIGITS = 2;
/** A Hetzner price as decimal text: digits, then a dot and digits. */
const DECIMAL_PATTERN = /^([0-9]+)(?:\.([0-9]+))?$/;
/** A Kubernetes memory quantity: decimal text and a binary or decimal suffix (`2Gi`, `500M`). */
const QUANTITY_PATTERN = /^([0-9]+)(?:\.([0-9]+))?([KMGTPE]i|[kMGTPE])?$/;
const BINARY_STEP = 1024n;
const DECIMAL_STEP = 1000n;
const BINARY_SUFFIXES = ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei"];
const DECIMAL_SUFFIXES = ["k", "M", "G", "T", "P", "E"];

const dateTime = z.iso.datetime({ offset: true });

/** The `from` and `to` of a report: ISO date-times, `from` before `to`. */
export const CostWindowSchema = z
  .object({ from: dateTime, to: dateTime })
  .refine((window) => Date.parse(window.from) < Date.parse(window.to), {
    message: "from must be before to",
    path: ["to"],
  });

export type CostWindow = z.infer<typeof CostWindowSchema>;

/** One server of the cluster in the window: its started hours and their net price. */
const WorkerCostSchema = z.object({
  node: z.string(),
  server_id: z.number().int(),
  server_type: z.string(),
  location: z.string(),
  /** Every started hour from `node.added` that starts inside the window; Hetzner bills each whole. */
  paid_hours: z.number().int(),
  /** The union of the box pod intervals on the server, cut to the window. */
  busy_hours: z.number(),
  /** Paid minus busy. */
  waste_hours: z.number(),
  /** Paid hours times `price_hourly.net`, decimal text to cents. */
  eur: z.string(),
});

/** One task's share of one worker's busy EUR. */
const TaskWorkerCostSchema = z.object({
  node: z.string(),
  server_id: z.number().int(),
  eur: z.string(),
});

/** One task: its share of each worker it ran on, and their sum. */
const TaskCostSchema = z.object({
  project: z.string().nullable(),
  task: z.string(),
  workers: z.array(TaskWorkerCostSchema),
  eur: z.string(),
});

export const CostReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  workers: z.array(WorkerCostSchema),
  tasks: z.array(TaskCostSchema),
  /** The sum of the worker lines. */
  total: WorkerCostSchema.pick({ paid_hours: true, eur: true }),
});

type WorkerCost = z.infer<typeof WorkerCostSchema>;
type TaskCost = z.infer<typeof TaskCostSchema>;
export type CostReport = z.infer<typeof CostReportSchema>;

/** A node event and the `at` of its row. */
export interface StoredNodeEvent {
  event: NodeEvent;
  at: string;
}

/** What one report reads: its window, every stored node event and every stored `job.finished`. */
interface CostInput {
  window: CostWindow;
  events: StoredNodeEvent[];
  pods: JobFinished[];
}

/** One server from its `node.added` to its `node.removed`, or to the end of the window. */
interface ServerSpan {
  added: NodeAdded;
  startMs: number;
  endMs: number;
}

/** An exact amount: `numerator / denominator`. */
interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

/** One task of one project; the same task id in two projects is two tasks. */
interface TaskKey {
  project: string | null;
  task: string;
}

/** One box pod's time on one server in the window, and its weight in the split of busy EUR. */
interface PodSpan extends TaskKey {
  startMs: number;
  endMs: number;
  /** Memory request bytes times milliseconds. */
  weight: bigint;
}

/** One task's share of one worker's busy EUR, in cents. */
interface TaskShare extends TaskKey {
  cents: bigint;
}

/** One server's paid hours, busy time and shares in the window, and its net price in cents. */
interface PaidWorker {
  added: NodeAdded;
  hours: number;
  busyMs: number;
  cents: bigint;
  shares: TaskShare[];
}

/** The milliseconds of a window. */
interface WindowMs {
  fromMs: number;
  toMs: number;
}

/** One server and the pods that may have run on it. */
interface ServerPods {
  span: ServerSpan;
  windowMs: WindowMs;
  pods: JobFinished[];
}

/** One pod and the server it may have run on. */
interface PodOnServer {
  pod: JobFinished;
  span: ServerSpan;
  fromMs: number;
}

/** A worker's busy time, its price and the pods that share it. */
interface BusyCost {
  podSpans: PodSpan[];
  busyMs: number;
  price: Fraction;
}

/** One task's memory x time weight on one worker. */
interface TaskWeight extends TaskKey {
  weight: bigint;
}

/** One task and its shares of the workers it ran on. */
interface TaskShares extends TaskKey {
  shares: WorkerShare[];
}

/** One task's share of one worker. */
interface WorkerShare {
  worker: PaidWorker;
  cents: bigint;
}

/**
 * Paid, busy and wasted hours and net EUR per worker in the window, and each task's share of the
 * busy EUR; a server with no paid hour there has no line.
 */
export function costReport(input: CostInput): CostReport {
  const { window, events, pods } = input;
  const windowMs = { fromMs: Date.parse(window.from), toMs: Date.parse(window.to) };
  const paid = serverSpans(events, windowMs)
    .map((span) => paidWorker({ span, windowMs, pods }))
    .filter((worker) => worker.hours > 0);
  const cents = paid.reduce((sum, worker) => sum + worker.cents, 0n);
  const hours = paid.reduce((sum, worker) => sum + worker.hours, 0);
  const total = { paid_hours: hours, eur: centsText(cents) };
  return { ...window, workers: paid.map(workerLine), tasks: taskLines(paid), total };
}

/** Servers are matched by id, the oldest first; a removal with no `node.added` has no price. */
function serverSpans(events: StoredNodeEvent[], windowMs: WindowMs): ServerSpan[] {
  const removedMs = new Map<number, number>();
  for (const stored of events) {
    const { event, at } = stored;
    if (event.event === "node.removed") removedMs.set(event.server_id, Date.parse(at));
  }
  const spans = events.flatMap((stored) => {
    const { event, at } = stored;
    if (event.event !== "node.added") return [];
    const endMs = Math.min(removedMs.get(event.server_id) ?? windowMs.toMs, windowMs.toMs);
    return [{ added: event, startMs: Date.parse(at), endMs }];
  });
  return spans.sort((a, b) => a.startMs - b.startMs || a.added.server_id - b.added.server_id);
}

function paidWorker(input: ServerPods): PaidWorker {
  const { span, windowMs, pods } = input;
  const { added } = span;
  const hours = paidHours(span, windowMs);
  const price = readPrice(added);
  const podSpans = pods.flatMap((pod) => podSpan({ pod, span, fromMs: windowMs.fromMs }));
  const busyMs = unionMs(podSpans);
  return {
    added,
    hours,
    busyMs,
    cents: roundedCents({
      numerator: price.numerator * BigInt(hours),
      denominator: price.denominator,
    }),
    shares: taskShares({ podSpans, busyMs, price }),
  };
}

function workerLine(worker: PaidWorker): WorkerCost {
  const { added } = worker;
  return {
    node: added.node,
    server_id: added.server_id,
    server_type: added.server_type,
    location: added.location,
    paid_hours: worker.hours,
    busy_hours: worker.busyMs / MS_PER_HOUR,
    waste_hours: (worker.hours * MS_PER_HOUR - worker.busyMs) / MS_PER_HOUR,
    eur: centsText(worker.cents),
  };
}

/** The started hours `start + k h` with `from <= start + k h < end`. */
function paidHours(span: ServerSpan, windowMs: WindowMs): number {
  const first = Math.max(0, Math.ceil((windowMs.fromMs - span.startMs) / MS_PER_HOUR));
  const afterLast = Math.ceil((span.endMs - span.startMs) / MS_PER_HOUR);
  return Math.max(0, afterLast - first);
}

/** A pod ran on a server when it started on its Node name while the server was there. */
function podSpan(input: PodOnServer): PodSpan[] {
  const { pod, span, fromMs } = input;
  if (pod.started === null || pod.node !== span.added.node) return [];
  const startMs = Math.max(Date.parse(pod.started), span.startMs, fromMs);
  const endMs = Math.min(Date.parse(pod.finished), span.endMs);
  if (endMs <= startMs) return [];
  return [
    {
      project: pod.project,
      task: pod.task,
      startMs,
      endMs,
      weight: memoryBytes(pod) * BigInt(endMs - startMs),
    },
  ];
}

/** Overlapping pods count their overlap once. */
function unionMs(spans: PodSpan[]): number {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let coveredMs = Number.NEGATIVE_INFINITY;
  for (const span of sorted) {
    total += Math.max(0, span.endMs - Math.max(span.startMs, coveredMs));
    coveredMs = Math.max(coveredMs, span.endMs);
  }
  return total;
}

/** The busy EUR split by memory request x time; with no memory request on the worker, nothing is split. */
function taskShares(input: BusyCost): TaskShare[] {
  const { podSpans, busyMs, price } = input;
  const weights = new Map<string, TaskWeight>();
  for (const span of podSpans) {
    const key = taskKey(span);
    const known = weights.get(key)?.weight ?? 0n;
    weights.set(key, { project: span.project, task: span.task, weight: known + span.weight });
  }
  const all = [...weights.values()].reduce((sum, item) => sum + item.weight, 0n);
  const busy = { numerator: price.numerator * BigInt(busyMs), denominator: price.denominator };
  return [...weights.values()].map(({ project, task, weight }) => ({
    project,
    task,
    cents:
      all === 0n
        ? 0n
        : roundedCents({
            numerator: busy.numerator * weight,
            denominator: busy.denominator * BigInt(MS_PER_HOUR) * all,
          }),
  }));
}

/** Tasks by project, then task id, a null project first; each lists its workers in the order of the worker lines. */
function taskLines(paid: PaidWorker[]): TaskCost[] {
  const byTask = new Map<string, TaskShares>();
  for (const worker of paid) {
    for (const share of worker.shares) {
      const key = taskKey(share);
      const known = byTask.get(key)?.shares ?? [];
      const shares = [...known, { worker, cents: share.cents }];
      byTask.set(key, { project: share.project, task: share.task, shares });
    }
  }
  return [...byTask.values()].sort(compareTasks).map(({ project, task, shares }) => ({
    project,
    task,
    workers: shares.map((share) => ({
      node: share.worker.added.node,
      server_id: share.worker.added.server_id,
      eur: centsText(share.cents),
    })),
    eur: centsText(shares.reduce((sum, share) => sum + share.cents, 0n)),
  }));
}

/** A map key that tells `("a", "b/c")` from `("a/b", "c")` and a null project from any name. */
function taskKey(task: TaskKey): string {
  return JSON.stringify([task.project, task.task]);
}

function compareTasks(a: TaskKey, b: TaskKey): number {
  if (a.project !== b.project)
    return compareText(a.project ?? "", b.project ?? "") || (a.project === null ? -1 : 1);
  return compareText(a.task, b.task);
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The net hourly price in EUR, exact. */
function readPrice(added: NodeAdded): Fraction {
  const price = added.price_hourly.net;
  const match = DECIMAL_PATTERN.exec(price);
  if (match === null) {
    throw badFileError(`price_hourly.net of ${added.node}`, [`not decimal text: ${price}`]);
  }
  return decimalFraction(match);
}

/** The memory request of the box container in bytes; none is 0. */
function memoryBytes(pod: JobFinished): bigint {
  const { memory } = pod.requests;
  if (memory === null) return 0n;
  const match = QUANTITY_PATTERN.exec(memory);
  if (match === null) {
    throw badFileError(`requests.memory of ${pod.pod}`, [`not a quantity: ${memory}`]);
  }
  const amount = decimalFraction(match);
  return (amount.numerator * suffixFactor(match[3] ?? "")) / amount.denominator;
}

/** The digits before and after the dot of a match, as a fraction. */
function decimalFraction(match: RegExpExecArray): Fraction {
  const fraction = match[2] ?? "";
  return {
    numerator: BigInt(`${match[1]}${fraction}`),
    denominator: DECIMAL_BASE ** BigInt(fraction.length),
  };
}

function suffixFactor(suffix: string): bigint {
  const binary = BINARY_SUFFIXES.indexOf(suffix);
  if (binary >= 0) return BINARY_STEP ** BigInt(binary + 1);
  const decimal = DECIMAL_SUFFIXES.indexOf(suffix);
  if (decimal >= 0) return DECIMAL_STEP ** BigInt(decimal + 1);
  return 1n;
}

/** EUR rounded half up to cents. */
function roundedCents(eur: Fraction): bigint {
  return (eur.numerator * CENTS_PER_EUR * 2n + eur.denominator) / (eur.denominator * 2n);
}

function centsText(cents: bigint): string {
  const digits = cents.toString().padStart(CENT_DIGITS + 1, "0");
  return `${digits.slice(0, -CENT_DIGITS)}.${digits.slice(-CENT_DIGITS)}`;
}
