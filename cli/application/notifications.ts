import { type Notification, notificationLine } from "../../domain/notifications.ts";
import { errorMessage } from "../../domain/utils.ts";
import { log } from "../infra/env.ts";
import { notify } from "../infra/notify.ts";
import { manifests } from "./manifests.ts";
import { projects } from "./projects.ts";

/** A notification of one task; the project name comes from its task worktree. */
export type TaskNotification = Omit<Notification, "project">;

interface NotificationSend {
  taskWorktree: string;
  notification: TaskNotification;
}

/** One line per event a person must act on, sent to the ntfy topic of the manifest. */
export const notifications = { send };

/** Sends nothing without `notify.ntfy`. A failed send is one stderr line, never an error. */
async function send(input: NotificationSend): Promise<void> {
  const { taskWorktree, notification } = input;
  const { project } = await projects.get(taskWorktree);
  const { notify: config } = await manifests.get(project.mainDir, taskWorktree);
  if (config.ntfy === undefined) return;
  const line = notificationLine({ ...notification, project: project.name });
  try {
    await notify.send({ url: config.ntfy, line });
  } catch (e) {
    log(`notification not sent: ${errorMessage(e)}`);
  }
}
