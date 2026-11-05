import { inArray } from "drizzle-orm";
import type { Queryable } from "../db/index.ts";
import { events } from "../db/schema.ts";

interface EventRow {
  id: string;
  type: string;
  subject: string;
  /** Null for an event the server makes itself. */
  userId: string | null;
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

/** Every row of these event types. */
function findByTypes(db: Queryable, types: string[]): EventRow[] {
  return db.select().from(events).where(inArray(events.type, types)).all();
}

export const eventsRepository = { insert, findByTypes };
