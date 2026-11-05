import type { Queryable } from "../db/index.ts";
import { events } from "../db/schema.ts";

interface EventRow {
  id: string;
  type: string;
  subject: string;
  userId: string;
  tenbox: string;
  at: string;
  body: string;
}

/** Stores the row unless its id exists; true when a row went in. */
function insert(db: Queryable, row: EventRow): boolean {
  const inserted = db
    .insert(events)
    .values(row)
    .onConflictDoNothing({ target: events.id })
    .returning({ id: events.id })
    .all();
  return inserted.length > 0;
}

export const eventsRepository = { insert };
