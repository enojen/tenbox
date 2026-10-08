import type { Project } from "../../domain/project.ts";
import { files } from "../../infra/files.ts";
import { git } from "../../infra/git.ts";

export type WorktreeRemoveState = "removed" | "skipped";

export type BranchRemoveState = "deleted" | "skipped";

export interface WorktreeRemoval {
  project: Project;
  taskWorktree: string;
  branch: string;
}

export interface RemoveStates {
  worktree: WorktreeRemoveState;
  branch: BranchRemoveState;
}

/** Removes the task worktree, then its branch; each is skipped when it is already gone. */
export async function remove(removal: WorktreeRemoval): Promise<RemoveStates> {
  const { project, taskWorktree, branch } = removal;
  const worktree = await removeWorktree(project.mainDir, taskWorktree);
  const branchState = await removeBranch(project.mainDir, branch);
  return { worktree, branch: branchState };
}

async function removeWorktree(mainDir: string, taskWorktree: string): Promise<WorktreeRemoveState> {
  const exists = await files.isDir(taskWorktree);
  if (!exists) return "skipped";
  await git.removeWorktree(mainDir, taskWorktree);
  return "removed";
}

async function removeBranch(mainDir: string, branch: string): Promise<BranchRemoveState> {
  const exists = await git.branchExists(mainDir, branch);
  if (!exists) return "skipped";
  await git.deleteBranch(mainDir, branch);
  return "deleted";
}
