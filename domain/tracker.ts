import type { TrackerKind } from "./manifest.ts";

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

/** The port to the tracker; `infra/tracker/` holds one adapter per kind. */
export interface Tracker {
  readonly kind: TrackerKind;
  getTask(id: string): Promise<TrackerTask>;
  /** Sets the status and returns the name of the status the tracker now shows. */
  updateStatus(id: string, status: TaskStatus): Promise<string>;
  comment(request: CommentRequest): Promise<void>;
  /** The comments of the task, oldest first. */
  comments(id: string): Promise<TrackerComment[]>;
}

/** The comments sorted by date, oldest first. */
export const oldestFirst = (comments: TrackerComment[]): TrackerComment[] =>
  [...comments].sort((a, b) => a.date.localeCompare(b.date));
