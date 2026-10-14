import type { Usage } from "../../../domain/runs.ts";
import { isPlainObject, parseObject } from "../../../domain/utils.ts";
import { files } from "../files.ts";

/*
 * An agent's transcript, `agent-<agentId>.jsonl` (not a public API): one JSON object per line.
 * Only the token counts, the model and the times are read, never the text.
 */

type Json = Record<string, unknown>;

/** What the transcript says about its agent; the times and the model are null without a line. */
export interface Transcript {
  usage: Usage;
  model: string | null;
  /** `timestamp` of the first and of the last line that has one. */
  firstAt: string | null;
  lastAt: string | null;
}

/** The sum of the assistant messages' usage, the model and the times; null when the transcript is missing. */
export async function readTranscript(file: string): Promise<Transcript | null> {
  const text = await files.read(file);
  if (text === null) return null;
  const byMessage = new Map<string, Json>();
  const times: string[] = [];
  let model: string | null = null;
  for (const line of text.split("\n")) {
    const entry = parseObject(line);
    if (entry === null) continue;
    if (typeof entry.timestamp === "string") times.push(entry.timestamp);
    const message = assistantMessage(entry);
    // One message spans several lines and the last one has the final counts.
    if (message === null) continue;
    byMessage.set(message.id, message.usage);
    model = message.model ?? model;
  }
  return {
    usage: sumMessages([...byMessage.values()]),
    model,
    firstAt: times[0] ?? null,
    lastAt: times.at(-1) ?? null,
  };
}

interface MessageUsage {
  id: string;
  usage: Json;
  model: string | null;
}

function assistantMessage(entry: Json): MessageUsage | null {
  if (entry.type !== "assistant") return null;
  const { message } = entry;
  if (!isPlainObject(message) || typeof message.id !== "string") return null;
  if (!isPlainObject(message.usage)) return null;
  const model = typeof message.model === "string" ? message.model : null;
  return { id: message.id, usage: message.usage, model };
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
