import { BUILD_STATUS, type BuildStatus } from "./build.ts";
import type { TaskId } from "./ids.ts";

/** What a person must act on: three build statuses and three events. */
export const NOTIFICATION_STATE = {
  needsYou: BUILD_STATUS.needsYou,
  readyForYou: BUILD_STATUS.readyForYou,
  failed: BUILD_STATUS.failed,
  checkFailed: "check-failed",
  prOpened: "pr-opened",
  planReady: "plan-ready",
} as const;

export type NotificationState = (typeof NOTIFICATION_STATE)[keyof typeof NOTIFICATION_STATE];

export interface Notification {
  project: string;
  id: TaskId;
  state: NotificationState;
  /** What happened, in a few words; left out when the state says it all. */
  detail?: string;
  /** The recommended option of a `needs-you` decision card; the line then names `tenbox answer`. */
  recommended?: number;
}

const SEPARATOR = " · ";

const NEXT_COMMAND: Record<NotificationState, (notification: Notification) => string> = {
  [NOTIFICATION_STATE.needsYou]: (n) =>
    n.recommended === undefined
      ? `tenbox attach ${n.id}`
      : `tenbox answer ${n.id} ${n.recommended}`,
  [NOTIFICATION_STATE.readyForYou]: (n) => `tenbox pr ${n.id} --ready`,
  [NOTIFICATION_STATE.failed]: (n) => `tenbox attach ${n.id}`,
  [NOTIFICATION_STATE.checkFailed]: (n) => `tenbox attach ${n.id}`,
  [NOTIFICATION_STATE.prOpened]: (n) => `tenbox close ${n.id}`,
  [NOTIFICATION_STATE.planReady]: (n) => `tenbox approve ${n.id}`,
};

/** The state of a build end status a person must act on; null for `not-approved`. */
export function notificationStateOf(status: BuildStatus): NotificationState | null {
  return status === BUILD_STATUS.notApproved ? null : status;
}

/** `<project> · <task id> · <state> · <detail> → <next command>`. */
export function notificationLine(notification: Notification): string {
  const { project, id, state, detail } = notification;
  const parts = [project, id, state, ...(detail === undefined ? [] : [detail])];
  return `${parts.join(SEPARATOR)} → ${NEXT_COMMAND[state](notification)}`;
}
