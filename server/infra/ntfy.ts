import { http } from "./http.ts";

const SERVICE = "ntfy";

/** One notice: the ntfy topic URL and the text line to post to it. */
interface NtfyNotice {
  url: string;
  line: string;
}

/** A JSON publish goes to the ntfy server root and names the topic in the body, as the CLI sends it. */
async function send(notice: NtfyNotice): Promise<void> {
  const { origin, pathname } = new URL(notice.url);
  const response = await fetch(origin, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: pathname.slice(1), message: notice.line }),
    signal: http.timeout(),
  });
  if (response.ok) return;
  const text = await response.text();
  throw http.failed({ service: SERVICE, status: response.status, text });
}

/** ntfy: the server's own notices, such as an idle task volume. */
export const ntfy = { send };
