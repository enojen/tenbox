import type { TrackerKind } from "./manifest.ts";

export type TaskStatus = "in_progress" | "done";

export interface TrackerTask {
  id: string;
  title: string;
  description: string;
  url: string;
  status: string;
}

/** The port to the tracker; `infra/tracker/` holds one adapter per kind. */
export interface Tracker {
  readonly kind: TrackerKind;
  getTask(id: string): Promise<TrackerTask>;
  updateStatus(id: string, status: TaskStatus): Promise<void>;
}
