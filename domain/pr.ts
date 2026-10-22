import type { TaskId } from "./ids.ts";

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

/** What the CI checks of a PR add up to; `none` is a PR with no checks reported. */
export const CI_STATE = { pass: "pass", fail: "fail", pending: "pending", none: "none" } as const;

export type CiState = (typeof CI_STATE)[keyof typeof CI_STATE];

/** One line of `gh pr checks`: the state is gh's word (pass, fail, pending, skipping, cancel). */
export interface CiCheck {
  name: string;
  state: string;
  time: string;
  url: string;
}

/** The tab-separated output of `gh pr checks`: name, state, time, url; extra columns are ignored. */
export function parseCiChecks(stdout: string): CiCheck[] {
  return stdout
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [name = "", state = "", time = "", url = ""] = l.split("\t");
      return { name, state, time, url };
    });
}

const FAILED_CI = new Set(["fail", "cancel"]);

/** `fail` when any check failed or was cancelled, else `pending` when any is, else `pass`. */
export function ciState(checks: CiCheck[]): CiState {
  if (checks.length === 0) return CI_STATE.none;
  if (checks.some((c) => FAILED_CI.has(c.state))) return CI_STATE.fail;
  if (checks.some((c) => c.state === CI_STATE.pending)) return CI_STATE.pending;
  return CI_STATE.pass;
}
