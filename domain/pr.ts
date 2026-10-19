import type { TaskId } from "./ids.ts";
import { parseObject } from "./utils.ts";

/** What `tenbox pr` did with the PR. */
export const PR_STATE = { created: "created", updated: "updated" } as const;

/** What `tenbox pr` did with one group: a PR state, or why it left the group alone. */
export const GROUP_PR_STATE = {
  ...PR_STATE,
  waiting: "waiting",
  merged: "merged",
  conflict: "conflict",
} as const;

export type GroupPrState = (typeof GROUP_PR_STATE)[keyof typeof GROUP_PR_STATE];

/** `<id> · <title>`, or just the id when the task has no title. */
export function prTitle(id: TaskId, title: string | null): string {
  return title ? `${id} · ${title}` : id;
}

/** The first line of a group's PR body; `tenbox pr` and `tenbox close` find the PR by it. */
export const groupLine = (id: TaskId, group: number): string => `tenbox: ${id} group ${group}`;

export const bodyHasLine = (body: string, line: string): boolean =>
  body.split(/\r?\n/).some((l) => l === line);

/** The group line, the checks summary, then the whole plan folded; a part with no text is left out. */
export function prBody(
  line: string,
  planText: string | null,
  checksSummary: string | null,
): string {
  const parts = [
    line,
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
