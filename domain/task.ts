import path from "node:path";
import { z } from "zod";
import type { TaskId } from "./ids.ts";
import { type TrackerKind, TrackerKindSchema } from "./manifest.ts";
import { parseObject } from "./utils.ts";

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
/** `approved.json` in a `.tenbox/` folder: the `Approval`. */
export const approvedFile = (dir: string): string => path.join(dir, "approved.json");
/** `task.md` in a `.tenbox/` folder. */
export const taskMdFile = (dir: string): string => path.join(dir, "task.md");
/** `plan.md` in a `.tenbox/` folder. */
export const planMdFile = (dir: string): string => path.join(dir, "plan.md");
/** `parts/` in a `.tenbox/` folder. */
export const partsDir = (dir: string): string => path.join(dir, "parts");
/** `rounds/` in a `.tenbox/` folder. */
export const roundsDir = (dir: string): string => path.join(dir, "rounds");
/** `checks.json` in a round directory. */
export const checksFile = (round: string): string => path.join(round, "checks.json");
/** `checks-full.json` in a round directory: the result of the `full` tier. */
export const checksFullFile = (round: string): string => path.join(round, "checks-full.json");
/** `rounds/<N>` in a `.tenbox/` folder. */
export const roundDir = (dir: string, round: number): string =>
  path.join(roundsDir(dir), String(round));

/** `.tenbox/task.md`: what the planner reads after `decisions.md`. */
export function renderTaskMd(t: Task): string {
  const body = t.description.trim() || "(no description)";
  return `# ${t.id} · ${t.title}\n\nstatus: ${t.status}\ntracker: ${t.tracker}\nurl: ${t.url || "-"}\n\n${body}\n`;
}

/** `task.json` in a `.tenbox/` folder: the task as `tenbox start` saw it. */
export const taskFile = (dir: string): string => path.join(dir, "task.json");

const TaskFileSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  tracker: TrackerKindSchema,
  url: z.string().nullable(),
});

export type TaskFile = z.infer<typeof TaskFileSchema>;

/** The task without its description; a task with no url gets null. */
export function taskFileOf(t: Task): TaskFile {
  return { id: t.id, title: t.title, status: t.status, tracker: t.tracker, url: t.url || null };
}

/** The task in `task.json` text; null when it is not a JSON object or does not match. */
export function readTaskFile(text: string): TaskFile | null {
  const parsed = TaskFileSchema.safeParse(parseObject(text));
  return parsed.success ? parsed.data : null;
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

/** Highest round directory name; 1 when there is none. */
export function currentRound(roundDirNames: string[]): number {
  return roundNumbers(roundDirNames).at(-1) ?? 1;
}
