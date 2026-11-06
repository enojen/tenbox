import { type CostReport, type CostWindow, costReport } from "../../domain/costs.ts";
import { NODE_EVENT_NAMES, readNodeEvent } from "../../domain/events.ts";
import type { Db } from "../infra/db/index.ts";
import { eventsRepository } from "../infra/repositories/events.ts";

/** Reads every node event: a server that came before the window may still be paid in it. */
function get(db: Db, window: CostWindow): CostReport {
  const events = eventsRepository.findByTypes(db, NODE_EVENT_NAMES).map((row) => ({
    event: readNodeEvent(row.body, `event ${row.id}`),
    at: row.at,
  }));
  return costReport({ window, events });
}

/** Costs: what the workers of the cluster were paid for in a window, from the node events. */
export const costs = { get };
