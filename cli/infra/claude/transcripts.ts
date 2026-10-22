import { z } from "zod";
import type { Usage } from "../../../domain/runs.ts";
import { claudeFiles } from "./claudeFiles.ts";

/*
 * An agent's transcript, `agent-<agentId>.jsonl` (not a public API): one JSON object per line.
 * Only the token counts, the model and the times are read, never the text.
 */

const ASSISTANT = "assistant";

const MessageUsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
});

type MessageUsage = z.infer<typeof MessageUsageSchema>;

/** A line of the model's answer: one message spans several lines and the last has the final counts. */
const AssistantLineSchema = z.object({
  type: z.literal(ASSISTANT),
  timestamp: z.string().optional(),
  message: z.object({ id: z.string(), model: z.string().optional(), usage: MessageUsageSchema }),
});

/** Any other line (user, attachment and more): only its time is read. */
const OtherLineSchema = z.object({
  type: z.string().refine((type) => type !== ASSISTANT),
  timestamp: z.string().optional(),
});

const LineSchema = z.union([AssistantLineSchema, OtherLineSchema]);

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
  const lines = await claudeFiles.findLines(LineSchema, file);
  if (lines === null) return null;
  const byMessage = new Map<string, MessageUsage>();
  const times: string[] = [];
  let model: string | null = null;
  for (const line of lines) {
    if (line.timestamp !== undefined) times.push(line.timestamp);
    if (!("message" in line)) continue;
    byMessage.set(line.message.id, line.message.usage);
    model = line.message.model ?? model;
  }
  return {
    usage: sumMessages([...byMessage.values()]),
    model,
    firstAt: times[0] ?? null,
    lastAt: times.at(-1) ?? null,
  };
}

function sumMessages(messages: MessageUsage[]): Usage {
  const sum = (key: keyof MessageUsage) =>
    messages.reduce((total, usage) => total + (usage[key] ?? 0), 0);
  return {
    calls: messages.length,
    input: sum("input_tokens"),
    output: sum("output_tokens"),
    cache_write: sum("cache_creation_input_tokens"),
    cache_read: sum("cache_read_input_tokens"),
  };
}
