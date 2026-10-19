import { groupMergeConflictError, unknownGroupError } from "../../domain/errors/tasks.ts";
import { type TaskId, taskBranch } from "../../domain/ids.ts";
import type { Manifest } from "../../domain/manifest.ts";
import type { Project } from "../../domain/project.ts";
import {
  groupBranch,
  groupDir,
  groupFile,
  groupWorktreeDir,
  readGroupStart,
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
export const groups = { ensure, rebase, listExtra };

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
  const reused = await git.branchExists(project.mainDir, branch);
  await worktrees.ensure({ project, taskWorktree: worktree, taskDir, branch, base: start });
  for (const other of others) {
    const conflicted = await git.merge(worktree, other);
    if (conflicted.length === 0) continue;
    await worktrees.remove({ project, taskWorktree: worktree, branch });
    throw groupMergeConflictError(branch, [start, ...others], conflicted);
  }
  await setups.run(worktree, manifest.setup, true);
  const commit = await git.findCommit(worktree, reused ? start : "HEAD");
  const dir = groupDir(tenboxDir(taskWorktree), group);
  await files.writeJson(groupFile(dir), { start: commit ?? start });
}

interface RebaseRequest {
  taskWorktree: string;
  group: number;
  /** The group worktree, on the group branch. */
  worktree: string;
  base: string;
}

/**
 * Replays the group's own commits, those after the start in `group.json`, onto `origin/<base>`
 * and saves that base as the new start. Returns the conflicted files; the branch is as before then.
 */
async function rebase(request: RebaseRequest): Promise<string[]> {
  const { taskWorktree, group, worktree, base } = request;
  const file = groupFile(groupDir(tenboxDir(taskWorktree), group));
  const text = await files.read(file);
  const saved = text === null ? null : readGroupStart(text);
  if (saved === null) return [];
  await git.fetch(worktree);
  const onto = `origin/${base}`;
  const conflicted = await git.rebaseOnto(worktree, onto, saved.start);
  if (conflicted.length > 0) return conflicted;
  const start = await git.findCommit(worktree, onto);
  await files.writeJson(file, { start });
  return [];
}

/** A group above 1 as `tenbox close` sees it: its worktree and its branch by name. */
export interface ExtraGroup {
  group: number;
  worktree: string;
  branch: string;
}

interface ExtraGroupsRequest {
  /** The task dir; `plan.json` is read there. */
  planDir: string;
  taskWorktree: string;
  taskBranch: string;
}

/** The groups above 1 of the plan; none for a plan without groups. */
async function listExtra(request: ExtraGroupsRequest): Promise<ExtraGroup[]> {
  const { planDir, taskWorktree, taskBranch } = request;
  const plan = await plans.find(planDir);
  const listed = plan?.groups ?? [];
  return listed
    .filter((g) => g.id > 1)
    .map((g) => ({
      group: g.id,
      worktree: groupWorktreeDir(taskWorktree, g.id),
      branch: groupBranch(taskBranch, g.id),
    }));
}
