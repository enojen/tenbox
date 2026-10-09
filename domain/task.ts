import path from "node:path";
import type { TaskId } from "./ids.ts";
import type { TrackerKind } from "./manifest.ts";

export interface Task {
  id: TaskId;
  title: string;
  description: string;
  url: string;
  status: string;
  tracker: TrackerKind;
}

export const tenboxDir = (taskWorktree: string): string => path.join(taskWorktree, ".tenbox");
/** `proofs.json` in a `.tenbox/` folder. */
export const proofsFile = (dir: string): string => path.join(dir, "proofs.json");
export const roundDir = (taskWorktree: string, round: number): string =>
  path.join(tenboxDir(taskWorktree), "rounds", String(round));

/** `.tenbox/task.md`: what the planner reads after `decisions.md`. */
export function renderTaskMd(t: Task): string {
  const body = t.description.trim() || "(no description)";
  return `# ${t.id} · ${t.title}\n\nstatus: ${t.status}\ntracker: ${t.tracker}\nurl: ${t.url || "-"}\n\n${body}\n`;
}

const TITLE_LINE = /^#\s+\S+\s+·\s+(.+)$/;

/** The title in the first line of `task.md`, `# TEN-1 · title`; the reverse of `renderTaskMd`. */
export function titleFromTaskMd(text: string | null): string | null {
  if (text === null) return null;
  const match = TITLE_LINE.exec(text.split("\n")[0] ?? "");
  return match?.[1]?.trim() ?? null;
}

/** The round numbers among directory names, lowest first; other names are left out. */
export function roundNumbers(roundDirNames: string[]): number[] {
  const nums = roundDirNames.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return nums.sort((a, b) => a - b);
}

/** Highest round directory name plus one; 1 when there is none. */
export function nextRound(roundDirNames: string[]): number {
  const nums = roundNumbers(roundDirNames);
  return nums.length ? Math.max(...nums) + 1 : 1;
}
