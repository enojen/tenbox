import { BUILD_STATUS, type BuildStatus } from "./build.ts";
import type { TaskId } from "./ids.ts";

/** What a person must act on: three build statuses and two events. */
export const NOTIFICATION_STATE = {
  needsYou: BUILD_STATUS.needsYou,
  readyForYou: BUILD_STATUS.readyForYou,
  failed: BUILD_STATUS.failed,
  checkFailed: "check-failed",
  prOpened: "pr-opened",
} as const;

export type NotificationState = (typeof NOTIFICATION_STATE)[keyof typeof NOTIFICATION_STATE];

export interface Notification {
  project: string;
  id: TaskId;
  state: NotificationState;
  /** What happened, in a few words; left out when the state says it all. */
  detail?: string;
}

const SEPARATOR = " · ";

const NEXT_COMMAND: Record<NotificationState, (id: TaskId) => string> = {
  [NOTIFICATION_STATE.needsYou]: (id) => `tenbox attach ${id}`,
  [NOTIFICATION_STATE.readyForYou]: (id) => `tenbox pr ${id}`,
  [NOTIFICATION_STATE.failed]: (id) => `tenbox attach ${id}`,
  [NOTIFICATION_STATE.checkFailed]: (id) => `tenbox attach ${id}`,
  [NOTIFICATION_STATE.prOpened]: (id) => `tenbox close ${id}`,
};

/** The state of a build end status a person must act on; null for `not-approved`. */
export function notificationStateOf(status: BuildStatus): NotificationState | null {
  return status === BUILD_STATUS.notApproved ? null : status;
}

/** `<project> · <task id> · <state> · <detail> → <next command>`. */
export function notificationLine(notification: Notification): string {
  const { project, id, state, detail } = notification;
  const parts = [project, id, state, ...(detail === undefined ? [] : [detail])];
  return `${parts.join(SEPARATOR)} → ${NEXT_COMMAND[state](id)}`;
}
