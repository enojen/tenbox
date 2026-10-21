import type { TaskId } from "../../domain/ids.ts";
import { approvedFile, TASK_STATE, tenboxDir } from "../../domain/task.ts";
import { approvals } from "../application/approvals.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { ApproveResult } from "./results.ts";

/** Records that the person approved the plan: the time and the sha of `plan.md`. */
export async function approveTask(id: TaskId): Promise<ApproveResult> {
  const taskWorktree = await worktrees.get(id);
  const approval = await approvals.save(taskWorktree);
  await tasks.saveStatus(tenboxDir(taskWorktree), TASK_STATE.approved);
  return { ok: true, task: id, file: approvedFile(tenboxDir(taskWorktree)), ...approval };
}
