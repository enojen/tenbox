import { type CostReport, type CostWindow, costReport } from "../../domain/costs.ts";
import {
  JOB_FINISHED,
  NODE_EVENT_NAMES,
  readJobFinished,
  readNodeEvent,
} from "../../domain/events.ts";
import type { Db } from "../infra/db/index.ts";
import { eventsRepository } from "../infra/repositories/events.ts";

/**
 * Reads every node event and every `job.finished`: a server that came, or a pod that started,
 * before the window may still count in it.
 */
function get(db: Db, window: CostWindow): CostReport {
  const events = eventsRepository.findByTypes(db, NODE_EVENT_NAMES).map((row) => ({
    event: readNodeEvent(row.body, `event ${row.id}`),
    at: row.at,
  }));
  const pods = eventsRepository
    .findByTypes(db, [JOB_FINISHED])
    .map((row) => readJobFinished(row.body, `event ${row.id}`));
  return costReport({ window, events, pods });
}

/** Costs: what the workers of the cluster were paid for in a window, and each task's share. */
export const costs = { get };
