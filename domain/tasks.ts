import { z } from "zod";
import { badFileError } from "./errors/index.ts";
import type { TaskId } from "./ids.ts";
import { type TaskKind, TaskKindSchema } from "./kinds.ts";
import { type TrackerKind, TrackerKindSchema } from "./manifests.ts";
import type { TrackerComment } from "./tracker.ts";
import { jsons } from "./utils.ts";

export interface Task {
  id: TaskId;
  title: string;
  description: string;
  url: string;
  status: string;
  tracker: TrackerKind;
  comments: TrackerComment[];
}

/** The states `task.json` `status` holds besides the `build.json` end statuses. */
export const TASK_STATE = {
  started: "started",
  planReady: "plan-ready",
  approved: "approved",
  building: "building",
  closed: "closed",
} as const;

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

/** The task in the text of `task.json`; `bad-file` when it is not JSON or does not match. */
export function readTaskFile(text: string, file: string): TaskFile {
  const result = jsons.check(TaskFileSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}

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
