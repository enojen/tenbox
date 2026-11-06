import { serviceError } from "../../domain/errors/tools.ts";

const SERVICE = "ntfy";
const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_CHARS = 200;

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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.ok) return;
  const text = await response.text();
  throw serviceError(
    SERVICE,
    SERVICE,
    `HTTP ${response.status}: ${text.slice(0, ERROR_BODY_CHARS)}`,
  );
}

/** ntfy: the server's own notices, such as an idle task volume. */
export const ntfy = { send };
