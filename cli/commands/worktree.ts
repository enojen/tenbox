import type { TaskId } from "../../domain/ids.ts";
import { groups } from "../application/groups.ts";
import { projects } from "../application/projects.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { WorktreeResult } from "./results.ts";

export interface GroupWorktreeInput {
  id: TaskId;
  group: number;
}

export async function ensureGroupWorktree(input: GroupWorktreeInput): Promise<WorktreeResult> {
  const { id, group } = input;
  const taskWorktree = await worktrees.get(id);
  const { project, manifest } = await projects.get(taskWorktree);
  const checkout = await groups.ensure({ id, group, project, manifest, taskWorktree });
  return { ok: true, task: id, group, ...checkout };
}
