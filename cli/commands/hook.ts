import type { TaskId } from "../../domain/ids.ts";
import { blockedDetail, NOTIFICATION_STATE } from "../../domain/notifications.ts";
import { errorMessage } from "../../domain/utils.ts";
import { notifications } from "../application/notifications.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { log } from "../infra/env.ts";
import { stdin } from "../infra/stdin.ts";
import type { HookResult } from "./results.ts";

/**
 * Run by the Notification hook of a task session that waits on a permission prompt: sends one
 * `blocked` line. Never an error, so the hook cannot block the session; `sent` says what happened.
 */
export async function blockedHook(id: TaskId): Promise<HookResult> {
  const input = await stdin.read();
  const detail = blockedDetail(input);
  if (detail === null) return unsent(id, "stdin is not a JSON object");
  try {
    const taskWorktree = await worktrees.get(id);
    const notification = { id, state: NOTIFICATION_STATE.blocked, detail };
    const sent = await notifications.send({ taskWorktree, notification });
    return sent ? { ok: true, task: id, sent } : unsent(id, "no line sent");
  } catch (e) {
    return unsent(id, errorMessage(e));
  }
}

function unsent(id: TaskId, reason: string): HookResult {
  log(`tenbox hook blocked ${id}: ${reason}`);
  return { ok: true, task: id, sent: false };
}
