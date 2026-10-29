import { z } from "zod";
import { badInputError, issueLines } from "./errors/index.ts";
import type { TrackerKind } from "./manifests.ts";
import { jsons } from "./utils.ts";

/** The two statuses Tenbox sets on a tracker task. */
export const TASK_STATUS = { inProgress: "in_progress", done: "done" } as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export interface TrackerTask {
  id: string;
  title: string;
  description: string;
  url: string;
  status: string;
}

/** One comment on a tracker task. */
export interface TrackerComment {
  author: string;
  /** ISO 8601. */
  date: string;
  body: string;
}

/** One status change Tenbox asks of the tracker. */
export interface StatusChange {
  id: string;
  status: TaskStatus;
}

/** One comment Tenbox asks the tracker to add to a task. */
export interface CommentRequest {
  id: string;
  text: string;
}

/** The title and the three sections of a task Tenbox opens: why, what, and when it is done. */
const TaskDraftSchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
  what: z.string().min(1),
  done: z.string().min(1),
  labels: z.array(z.string().min(1)).default([]),
});

export type TaskDraft = z.infer<typeof TaskDraftSchema>;

/** Where a reported task was found: the task that ran, if any, and the tenbox commit. */
export interface TaskOrigin {
  task: string | null;
  tenbox: string;
}

/** What an adapter writes: the title, the rendered body and the labels. */
export interface NewTask {
  title: string;
  body: string;
  labels: string[];
}

/** A task in the tracker, by its id and its page. */
export interface TaskRef {
  id: string;
  url: string;
}

/** The port to the tracker; `infra/tracker/` holds one adapter per kind. */
export interface Tracker {
  readonly kind: TrackerKind;
  getTask(id: string): Promise<TrackerTask>;
  /** Sets the status and returns the name of the status the tracker now shows. */
  updateStatus(id: string, status: TaskStatus): Promise<string>;
  comment(request: CommentRequest): Promise<void>;
  /** The comments of the task, oldest first. */
  comments(id: string): Promise<TrackerComment[]>;
  /** The open task with exactly this title; null when there is none. */
  findOpen(title: string): Promise<TaskRef | null>;
  create(task: NewTask): Promise<TaskRef>;
}

const DRAFT_NAME = "the task";

/** The draft from the flags of `tenbox task new`; `bad-input` names the missing section. */
export function taskDraftOf(value: unknown): TaskDraft {
  const parsed = TaskDraftSchema.safeParse(value);
  if (!parsed.success) throw badInputError(DRAFT_NAME, issueLines(parsed.error));
  return parsed.data;
}

/** The draft in `--json` input; `bad-input` when it is not JSON or a section is missing. */
export function parseTaskDraft(text: string): TaskDraft {
  const result = jsons.check(TaskDraftSchema, text);
  if (!result.ok) throw badInputError(DRAFT_NAME, result.issues);
  return result.value;
}

/** The task as the tracker gets it: the house body, and the origin line of a reported task. */
export function newTaskOf(draft: TaskDraft, origin?: TaskOrigin): NewTask {
  const sections = [
    `**Why**\n${draft.why}`,
    `**What**\n${draft.what}`,
    `**Done when**\n${draft.done}`,
  ];
  if (origin) sections.push(originLine(origin));
  return { title: draft.title, body: sections.join("\n\n"), labels: draft.labels };
}

/** The labels as the first line of the body, for a writer the tracker lets set none. */
export function labelsIntoBody(task: NewTask): NewTask {
  if (task.labels.length === 0) return task;
  const line = `Suggested labels: ${task.labels.join(", ")}`;
  return { title: task.title, body: `${line}\n\n${task.body}`, labels: [] };
}

function originLine(origin: TaskOrigin): string {
  const found = origin.task === null ? "Found" : `Found by task ${origin.task}`;
  return `${found} on tenbox ${origin.tenbox}.`;
}

/** The comments sorted by date, oldest first. */
export const oldestFirst = (comments: TrackerComment[]): TrackerComment[] =>
  [...comments].sort((a, b) => a.date.localeCompare(b.date));
