import type { TaskId } from "../../domain/ids.ts";
import { approvedFile, tenboxDir } from "../../domain/task.ts";
import { approvals } from "../application/approvals.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { ApproveResult } from "./results.ts";

/** Checks that the plan was approved and has not changed since; prints the approval. */
export async function checkApproved(id: TaskId): Promise<ApproveResult> {
  const taskWorktree = await worktrees.get(id);
  const approval = await approvals.get(taskWorktree, id);
  return { ok: true, task: id, file: approvedFile(tenboxDir(taskWorktree)), ...approval };
}
