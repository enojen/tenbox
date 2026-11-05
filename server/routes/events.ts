import { createRoute, z } from "@hono/zod-openapi";
import { EventSchema } from "../../domain/events.ts";

const SavedEventsSchema = z
  .object({ ok: z.boolean(), stored: z.number().int(), skipped: z.number().int() })
  .openapi("SavedEvents");

export const eventsRoute = createRoute({
  method: "post",
  path: "/events",
  request: {
    body: { content: { "application/json": { schema: z.array(EventSchema) } }, required: true },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SavedEventsSchema } },
      description: "The new events are stored; an id the server has is skipped",
    },
  },
});
