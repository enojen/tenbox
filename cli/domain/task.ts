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
export const roundDir = (taskWorktree: string, round: number): string =>
  path.join(tenboxDir(taskWorktree), "rounds", String(round));

/** `.tenbox/task.md`: what the planner reads after `decisions.md`. */
export function renderTaskMd(t: Task): string {
  const body = t.description.trim() || "(no description)";
  return `# ${t.id} · ${t.title}\n\nstatus: ${t.status}\ntracker: ${t.tracker}\nurl: ${t.url || "-"}\n\n${body}\n`;
}

/** Highest round directory name plus one; 1 when there is none. */
export function nextRound(roundDirNames: string[]): number {
  const nums = roundDirNames.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return nums.length ? Math.max(...nums) + 1 : 1;
}
