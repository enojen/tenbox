import { type Event, eventSubject } from "../../domain/events.ts";
import type { Db } from "../infra/db/index.ts";
import { eventsRepository } from "../infra/repositories/events.ts";

/** The `tenbox` column of an event the server makes: it has no git sha. */
const SERVER_TENBOX = "server";

interface NewEvents {
  userId: string;
  events: Event[];
}

interface SavedEvents {
  stored: number;
  skipped: number;
}

/** One event the server makes from a cluster watch: no user, and its body as JSON. */
interface ServerEvent {
  id: string;
  type: string;
  subject: string;
  at: string;
  body: object;
}

/** Stores the whole list in one transaction; an id the database has is skipped. */
function save(db: Db, input: NewEvents): SavedEvents {
  const stored = db.transaction((tx) => {
    const rows = input.events.map((event) => ({
      id: event.id,
      type: event.event,
      subject: eventSubject(event),
      userId: input.userId,
      tenbox: event.tenbox,
      at: event.at,
      body: JSON.stringify(event),
    }));
    return rows.filter((row) => eventsRepository.insert(tx, row)).length;
  });
  return { stored, skipped: input.events.length - stored };
}

/** Stores one event the server made itself; an id the database has is skipped. */
function saveFromServer(db: Db, input: ServerEvent): void {
  eventsRepository.insert(db, {
    id: input.id,
    type: input.type,
    subject: input.subject,
    userId: null,
    tenbox: SERVER_TENBOX,
    at: input.at,
    body: JSON.stringify(input.body),
  });
}

/** Events: what the CLI reports as a task moves and what the server sees on the cluster, each kept as it came. */
export const events = { save, saveFromServer };
