import { sessionName, type TaskId } from "../../domain/ids.ts";
import { NOTIFICATION_STATE, notificationStateOf } from "../../domain/notifications.ts";
import { tenboxDir } from "../../domain/task.ts";
import { approvals } from "../application/approvals.ts";
import { builds } from "../application/builds.ts";
import { notifications, type TaskNotification } from "../application/notifications.ts";
import { projects } from "../application/projects.ts";
import { sessions } from "../application/sessions.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { files } from "../infra/files.ts";
import type { SendBuildResult, TaskFileResult } from "./results.ts";

/** Checks the approval, then starts `claude --bg` with `/tenbox-build <id>` in the task worktree. */
export async function sendBuild(id: TaskId): Promise<SendBuildResult> {
  const taskWorktree = await worktrees.get(id);
  await approvals.get(taskWorktree, id);
  const { manifest } = await projects.get(taskWorktree);
  const taskDir = await files.realPath(tenboxDir(taskWorktree));
  const sent = `/tenbox-build ${id}`;
  const start = {
    model: manifest.model,
    addDir: taskDir,
    name: sessionName(manifest.names, id),
    prompt: sent,
  };
  await sessions.run({ id, taskWorktree }, start);
  return { ok: true, task: id, sent };
}

export interface BuildDoneInput {
  id: TaskId;
  /** The build result as JSON text. */
  json: string;
}

/** Validates the build result and writes it to the task's `.tenbox/build.json`. */
export async function buildDone(input: BuildDoneInput): Promise<TaskFileResult> {
  const taskWorktree = await worktrees.get(input.id);
  const file = await builds.save(taskWorktree, input.json);
  await notifyEnd(input.id, taskWorktree);
  return { ok: true, task: input.id, file };
}

/** One line for an end status a person must act on; `not-approved` sends none. */
async function notifyEnd(id: TaskId, taskWorktree: string): Promise<void> {
  const result = await builds.find(tenboxDir(taskWorktree));
  if (result === null) return;
  const state = notificationStateOf(result.status);
  if (state === null) return;
  const detail = state === NOTIFICATION_STATE.needsYou ? result.attention[0] : undefined;
  const notification: TaskNotification = { id, state, ...(detail && { detail }) };
  await notifications.send({ taskWorktree, notification });
}
