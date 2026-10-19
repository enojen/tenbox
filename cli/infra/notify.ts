import { z } from "zod";
import { http } from "./http.ts";

/** One notification: the ntfy topic URL and the text line to post to it. */
interface NotifyRequest {
  url: string;
  line: string;
  /** The link a tap on the notification opens; no key in the body without it. */
  click?: string;
}

/** ntfy answers a publish with the message it stored. */
const PublishedSchema = z.object({ id: z.string() });

/** ntfy: a JSON publish goes to the server root and names the topic in the body. */
export const notify = { send };

async function send(request: NotifyRequest): Promise<void> {
  const { origin, pathname } = new URL(request.url);
  const endpoint = { service: "ntfy", url: origin, headers: {}, errorCode: "ntfy" };
  const topic = { topic: pathname.slice(1), message: request.line };
  const body = request.click === undefined ? topic : { ...topic, click: request.click };
  await http.post({ endpoint, body, schema: PublishedSchema });
}
