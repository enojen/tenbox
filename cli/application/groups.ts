import { groupMergeConflictError, unknownGroupError } from "../../domain/errors/tasks.ts";
import { type TaskId, taskBranch } from "../../domain/ids.ts";
import type { Manifest } from "../../domain/manifest.ts";
import type { Project } from "../../domain/project.ts";
import {
  groupBranch,
  groupDir,
  groupFile,
  groupWorktreeDir,
  tenboxDir,
} from "../../domain/task.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { plans } from "./plans.ts";
import { setups } from "./setups.ts";
import { worktrees } from "./worktrees/index.ts";

interface GroupCheckout {
  worktree: string;
  branch: string;
  created: boolean;
}

interface GroupRequest {
  id: TaskId;
  group: number;
  project: Project;
  manifest: Manifest;
  taskWorktree: string;
}

interface NewGroup {
  request: GroupRequest;
  worktree: string;
  branch: string;
  start: string;
  others: string[];
}

/** Groups of a task. Group 1 is the task itself; group N > 1 has its own worktree and branch. */
export const groups = { ensure };

async function ensure(request: GroupRequest): Promise<GroupCheckout> {
  const { id, group, manifest, taskWorktree } = request;
  const task = taskBranch(manifest.names, id);
  if (group === 1) return { worktree: taskWorktree, branch: task, created: false };
  const plan = await plans.find(tenboxDir(taskWorktree));
  const found = plan?.groups?.find((g) => g.id === group);
  if (!found) throw unknownGroupError(id, group);
  const worktree = groupWorktreeDir(taskWorktree, group);
  const branch = groupBranch(task, group);
  const exists = await files.isDir(worktree);
  if (exists) return { worktree, branch, created: false };
  const needs = found.needs.map((need) => (need === 1 ? task : groupBranch(task, need)));
  const [start = manifest.base, ...others] = needs;
  await create({ request, worktree, branch, start, others });
  return { worktree, branch, created: true };
}

async function create(next: NewGroup): Promise<void> {
  const { request, worktree, branch, start, others } = next;
  const { project, manifest, taskWorktree, group } = request;
  const taskDir = await files.realPath(tenboxDir(taskWorktree));
  await worktrees.ensure({ project, taskWorktree: worktree, taskDir, branch, base: start });
  for (const other of others) {
    const conflicted = await git.merge(worktree, other);
    if (conflicted.length === 0) continue;
    await worktrees.remove({ project, taskWorktree: worktree, branch });
    throw groupMergeConflictError(branch, [start, ...others], conflicted);
  }
  await setups.run(worktree, manifest.setup, true);
  const head = await git.findHead(worktree);
  const dir = groupDir(tenboxDir(taskWorktree), group);
  await files.writeJson(groupFile(dir), { start: head });
}
