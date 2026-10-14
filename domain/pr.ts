import type { TaskId } from "./ids.ts";
import { parseObject } from "./utils.ts";

/** What `tenbox pr` did with the PR. */
export const PR_STATE = { created: "created", updated: "updated" } as const;

export type PrState = (typeof PR_STATE)[keyof typeof PR_STATE];

/** `<id> · <title>`, or just the id when the task has no title. */
export function prTitle(id: TaskId, title: string | null): string {
  return title ? `${id} · ${title}` : id;
}

/** The checks summary, then the whole plan folded; a part with no text is left out. */
export function prBody(planText: string | null, checksSummary: string | null): string {
  const parts = [
    checksSummary ? `## Checks\n\n${checksSummary}` : null,
    planText ? `<details><summary>Plan</summary>\n\n${planText.trim()}\n</details>` : null,
  ];
  return parts.filter((part) => part !== null).join("\n\n");
}

/** `summary` from a round's `checks.json`; null when the text is missing or not JSON. */
export function checksSummary(text: string | null): string | null {
  if (text === null) return null;
  const parsed = parseObject(text);
  return typeof parsed?.summary === "string" ? parsed.summary : null;
}
