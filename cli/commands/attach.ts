import type { TaskId } from "../../domain/ids.ts";
import { sessions } from "../application/sessions.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { AttachResult } from "./results.ts";

/** Opens the task's newest background session in this terminal; prints after the user leaves. */
export async function attachTask(id: TaskId): Promise<AttachResult> {
  const taskWorktree = await worktrees.get(id);
  const session = await sessions.attach({ id, taskWorktree });
  return { ok: true, task: id, session };
}
