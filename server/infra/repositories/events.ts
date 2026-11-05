import { and, asc, eq, inArray } from "drizzle-orm";
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

/** The events of one type about one subject. */
interface SubjectEvents {
  type: string;
  subject: string;
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

/** The ids among these that have a row. */
function findIds(db: Queryable, ids: string[]): string[] {
  const rows = db.select({ id: events.id }).from(events).where(inArray(events.id, ids)).all();
  return rows.map((row) => row.id);
}

/** The rows of one type about one subject, oldest `at` first. */
function findBySubject(db: Queryable, input: SubjectEvents): EventRow[] {
  return db
    .select()
    .from(events)
    .where(and(eq(events.type, input.type), eq(events.subject, input.subject)))
    .orderBy(asc(events.at), asc(events.id))
    .all();
}

export const eventsRepository = { insert, findByTypes, findIds, findBySubject };
