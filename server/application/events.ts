import { type Event, eventSubject } from "../../domain/events.ts";
import type { Db } from "../infra/db/index.ts";
import { eventsRepository } from "../infra/repositories/events.ts";

interface NewEvents {
  userId: string;
  events: Event[];
}

interface SavedEvents {
  stored: number;
  skipped: number;
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

/** Events: what the CLI reports as a task moves, each kept as it came. */
export const events = { save };
