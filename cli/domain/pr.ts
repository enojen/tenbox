import type { TaskId } from "./ids.ts";
import { parseObject } from "./utils.ts";

const SECTION_START = /^## /;
const PLAN_SECTIONS = ["Risks and attention", "Summary"];

/** `<id> · <title>`, or just the id when the task has no title. */
export function prTitle(id: TaskId, title: string | null): string {
  return title ? `${id} · ${title}` : id;
}

/** The text under `## <heading>` up to the next `## `; null when missing or empty. */
export function planSection(planText: string, heading: string): string | null {
  const lines = planText.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => SECTION_START.test(line));
  const text = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return text === "" ? null : text;
}

/** Risks and attention, Summary, Checks; a part with no text is left out. */
export function prBody(planText: string | null, checksSummary: string | null): string {
  const plan = planText ?? "";
  const parts = PLAN_SECTIONS.map((heading) => bodyPart(heading, planSection(plan, heading)));
  parts.push(bodyPart("Checks", checksSummary));
  return parts.filter((part) => part !== null).join("\n\n");
}

/** `summary` from a round's `checks.json`; null when the text is missing or not JSON. */
export function checksSummary(text: string | null): string | null {
  if (text === null) return null;
  const parsed = parseObject(text);
  return typeof parsed?.summary === "string" ? parsed.summary : null;
}

function bodyPart(heading: string, text: string | null): string | null {
  return text ? `## ${heading}\n\n${text}` : null;
}
