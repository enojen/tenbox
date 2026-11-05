import { z } from "zod";
import { badFileError } from "./errors/index.ts";
import type { NodeAdded, NodeEvent } from "./events.ts";

const MS_PER_HOUR = 3_600_000;
const CENTS_PER_EUR = 100n;
const DECIMAL_BASE = 10n;
const CENT_DIGITS = 2;
/** A Hetzner price as decimal text: digits, then a dot and digits. */
const DECIMAL_PATTERN = /^([0-9]+)(?:\.([0-9]+))?$/;

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
  /** Paid hours times `price_hourly.net`, decimal text to cents. */
  eur: z.string(),
});

export const CostReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  workers: z.array(WorkerCostSchema),
  /** The sum of the worker lines. */
  total: WorkerCostSchema.pick({ paid_hours: true, eur: true }),
});

type WorkerCost = z.infer<typeof WorkerCostSchema>;
export type CostReport = z.infer<typeof CostReportSchema>;

/** A node event and the `at` of its row. */
export interface StoredNodeEvent {
  event: NodeEvent;
  at: string;
}

/** What one report reads: its window and every stored node event. */
interface CostInput {
  window: CostWindow;
  events: StoredNodeEvent[];
}

/** One server from its `node.added` to its `node.removed`, or to the end of the window. */
interface ServerSpan {
  added: NodeAdded;
  startMs: number;
  endMs: number;
}

/** One server's paid hours in the window and their net price in cents. */
interface PaidWorker {
  added: NodeAdded;
  hours: number;
  cents: bigint;
}

/** The milliseconds of a window. */
interface WindowMs {
  fromMs: number;
  toMs: number;
}

/** Paid hours and net EUR per worker in the window; a server with no paid hour there has no line. */
export function costReport(input: CostInput): CostReport {
  const { window, events } = input;
  const windowMs = { fromMs: Date.parse(window.from), toMs: Date.parse(window.to) };
  const paid = serverSpans(events, windowMs)
    .map((span) => paidWorker(span, windowMs))
    .filter((worker) => worker.hours > 0);
  const cents = paid.reduce((sum, worker) => sum + worker.cents, 0n);
  const hours = paid.reduce((sum, worker) => sum + worker.hours, 0);
  const total = { paid_hours: hours, eur: centsText(cents) };
  return { ...window, workers: paid.map(workerLine), total };
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

function paidWorker(span: ServerSpan, windowMs: WindowMs): PaidWorker {
  const { added } = span;
  const hours = paidHours(span, windowMs);
  return {
    added,
    hours,
    cents: hourCents({ price: added.price_hourly.net, hours, node: added.node }),
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
    eur: centsText(worker.cents),
  };
}

/** The started hours `start + k h` with `from <= start + k h < end`. */
function paidHours(span: ServerSpan, windowMs: WindowMs): number {
  const first = Math.max(0, Math.ceil((windowMs.fromMs - span.startMs) / MS_PER_HOUR));
  const afterLast = Math.ceil((span.endMs - span.startMs) / MS_PER_HOUR);
  return Math.max(0, afterLast - first);
}

/** One worker's hours at its hourly price. */
interface HourPrice {
  price: string;
  hours: number;
  node: string;
}

/** Exact in integer units of the price's last digit, then rounded half up to cents. */
function hourCents(input: HourPrice): bigint {
  const match = DECIMAL_PATTERN.exec(input.price);
  if (match === null) {
    throw badFileError(`price_hourly.net of ${input.node}`, [`not decimal text: ${input.price}`]);
  }
  const fraction = match[2] ?? "";
  const unit = DECIMAL_BASE ** BigInt(fraction.length);
  const amount = BigInt(`${match[1]}${fraction}`) * BigInt(input.hours);
  return (amount * CENTS_PER_EUR * 2n + unit) / (unit * 2n);
}

function centsText(cents: bigint): string {
  const digits = cents.toString().padStart(CENT_DIGITS + 1, "0");
  return `${digits.slice(0, -CENT_DIGITS)}.${digits.slice(-CENT_DIGITS)}`;
}
