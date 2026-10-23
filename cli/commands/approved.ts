import type { TaskId } from "../../domain/ids.ts";
import { approvedFile, tenboxDir } from "../../domain/taskDirs.ts";
import { TASK_STATE } from "../../domain/tasks.ts";
import { approvals } from "../application/approvals.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { ApproveResult } from "./results.ts";

/** Checks that the plan was approved and has not changed since; prints the approval. */
export async function checkApproved(id: TaskId): Promise<ApproveResult> {
  const taskWorktree = await worktrees.get(id);
  const approval = await approvals.get(taskWorktree, id);
  await tasks.saveStatus(tenboxDir(taskWorktree), TASK_STATE.building);
  return { ok: true, task: id, file: approvedFile(tenboxDir(taskWorktree)), ...approval };
}
