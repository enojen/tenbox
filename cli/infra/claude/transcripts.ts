import type { Usage } from "../../../domain/runs.ts";
import { isPlainObject, parseObject } from "../../../domain/utils.ts";
import { files } from "../files.ts";

/*
 * An agent's transcript, `agent-<agentId>.jsonl` (not a public API): one JSON object per line.
 * Only the token counts are read, never the text.
 */

type Json = Record<string, unknown>;

/** The sum of the assistant messages' usage; null when the transcript is missing. */
export async function readUsage(file: string): Promise<Usage | null> {
  const text = await files.read(file);
  if (text === null) return null;
  const byMessage = new Map<string, Json>();
  for (const line of text.split("\n")) {
    const message = assistantMessage(line);
    // One message spans several lines and the last one has the final counts.
    if (message !== null) byMessage.set(message.id, message.usage);
  }
  return sumMessages([...byMessage.values()]);
}

interface MessageUsage {
  id: string;
  usage: Json;
}

function assistantMessage(line: string): MessageUsage | null {
  const entry = parseObject(line);
  if (entry === null || entry.type !== "assistant") return null;
  const { message } = entry;
  if (!isPlainObject(message) || typeof message.id !== "string") return null;
  return isPlainObject(message.usage) ? { id: message.id, usage: message.usage } : null;
}

function sumMessages(messages: Json[]): Usage {
  const sum = (key: string) =>
    messages.reduce((total, usage) => total + (numberOf(usage[key]) ?? 0), 0);
  return {
    calls: messages.length,
    input: sum("input_tokens"),
    output: sum("output_tokens"),
    cache_write: sum("cache_creation_input_tokens"),
    cache_read: sum("cache_read_input_tokens"),
  };
}

const numberOf = (value: unknown): number | null => (typeof value === "number" ? value : null);
