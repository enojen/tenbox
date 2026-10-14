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
  updateStatus(id: string, status: TaskStatus): Promise<void>;
  comment(request: CommentRequest): Promise<void>;
}
