import { z } from "zod";
import type { TenportEvent } from "../../domain/tenportEvents.ts";
import type { TenportServer } from "./env.ts";
import { http } from "./http.ts";

interface EventsPost {
  server: TenportServer;
  events: TenportEvent[];
}

const RecordedSchema = z.object({ stored: z.number(), skipped: z.number() });

export const tenport = { sendEvents };

async function sendEvents(post: EventsPost): Promise<void> {
  const { server, events } = post;
  const endpoint = {
    service: "tenport",
    url: `${server.url.replace(/\/+$/, "")}/events`,
    headers: { Authorization: `Bearer ${server.token}` },
    errorCode: "tenport",
  };
  await http.ensure({ endpoint, body: events, schema: RecordedSchema });
}
