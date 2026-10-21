import path from "node:path";
import { z } from "zod";
import type { TaskId } from "./ids.ts";
import { type TaskKind, TaskKindSchema } from "./kind.ts";
import { type TrackerKind, TrackerKindSchema } from "./manifest.ts";
import type { PlanResult } from "./plan.ts";
import type { TrackerComment } from "./tracker.ts";
import { parseObject } from "./utils.ts";

export interface Task {
  id: TaskId;
  title: string;
  description: string;
  url: string;
  status: string;
  tracker: TrackerKind;
  comments: TrackerComment[];
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
/** `groups/<N>` in a `.tenbox/` folder. */
export const groupDir = (dir: string, group: number): string =>
  path.join(dir, "groups", String(group));
/** `group.json` in a group folder. */
export const groupFile = (dir: string): string => path.join(dir, "group.json");

const GroupStartSchema = z.object({ start: z.string() });

/** Where a group branch left its needs; `tenbox pr` replays only the commits after `start`. */
export type GroupStart = z.infer<typeof GroupStartSchema>;

/** The start in `group.json` text; null when it is not a JSON object or does not match. */
export function readGroupStart(text: string): GroupStart | null {
  const parsed = GroupStartSchema.safeParse(parseObject(text));
  return parsed.success ? parsed.data : null;
}
export const groupWorktreeDir = (taskWorktree: string, group: number): string =>
  `${taskWorktree}-${group}`;
export const groupBranch = (taskBranchName: string, group: number): string =>
  `${taskBranchName}-${group}`;

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
  const head = `# ${t.id} · ${t.title}\n\ntracker: ${t.tracker}\nurl: ${t.url || "-"}\n\n${body}\n`;
  return head + renderComments(t.comments);
}

function renderComments(comments: TrackerComment[]): string {
  if (comments.length === 0) return "";
  const entries = comments.map((c) => `\n### ${c.author} · ${c.date}\n\n${c.body}\n`);
  return `\n## Comments\n${entries.join("")}`;
}

/** The states `task.json` `status` holds besides the `build.json` end statuses. */
export const TASK_STATE = {
  started: "started",
  planReady: "plan-ready",
  approved: "approved",
  building: "building",
  closed: "closed",
} as const;

/** `task.json` in a `.tenbox/` folder: the task as `tenbox start` saw it. */
export const taskFile = (dir: string): string => path.join(dir, "task.json");

const TaskFileSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  tracker: TrackerKindSchema,
  url: z.string().nullable(),
  /** Set by `tenbox start --kind`; it wins over the planner's kind. */
  kind: TaskKindSchema.optional(),
});

export type TaskFile = z.infer<typeof TaskFileSchema>;

/** The task without its description; a task with no url gets null. */
export function taskFileOf(t: Task, kind: TaskKind | undefined): TaskFile {
  const file = {
    id: t.id,
    title: t.title,
    status: TASK_STATE.started,
    tracker: t.tracker,
    url: t.url || null,
  };
  return kind === undefined ? file : { ...file, kind };
}

/** The part id and file name of the one part of a `docs` task. */
const DOCS_PART_ID = "01";
export const DOCS_PART_FILE = "01-docs.md";

/** `plan.md` of a `docs` task: the title and the task text. */
export function renderDocsPlanMd(t: Task): string {
  return `# ${t.id} · ${t.title}\n\n${t.description.trim() || t.title}\n`;
}

/** The part file of a `docs` task. */
export function renderDocsPart(): string {
  return `# ${DOCS_PART_ID} · docs\nstatus: todo\nfiles: the documentation files the task names\nacceptance:\n- the change the task text asks for is in the docs\nresult:\n`;
}

/** The plan result of a `docs` task: one easy part, no examples, no decisions, no questions. */
export function docsPlanOf(t: Task): PlanResult {
  return {
    kind: "docs",
    summary: t.title,
    estimated_lines: 0,
    parts: [{ id: DOCS_PART_ID, difficulty: "easy" }],
    examples: [],
    decisions: [],
    lenses: [],
    questions: [],
  };
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
