import path from "node:path";
import { noWorktreeError } from "../../../domain/errors/tasks.ts";
import { type TaskId, taskBranch } from "../../../domain/ids.ts";
import type { Manifest } from "../../../domain/manifest.ts";
import { taskWorktreeDir } from "../../../domain/project.ts";
import { env } from "../../infra/env.ts";
import { files } from "../../infra/files.ts";
import { git } from "../../infra/git.ts";
import { projects } from "../projects.ts";

interface WorktreeLookup {
  cwd: string;
  wtRoot: string;
}

interface Checkout {
  top: string;
  manifest: Manifest;
}

/** The task's worktree: the current one when it is the task's, else `~/wt/<project>/<id>`. */
export async function get(id: TaskId): Promise<string> {
  const lookup = env();
  const near = await worktreeNearCwd(lookup, id);
  if (near !== null) return near;
  const underRoot = await worktreeUnderWtRoot(lookup, id);
  if (underRoot === null) {
    throw noWorktreeError(id);
  }
  return underRoot;
}

/** The checkout around `cwd` when it is the task's, else the task worktree of its project. */
async function worktreeNearCwd(lookup: WorktreeLookup, id: TaskId): Promise<string | null> {
  const top = await git.findTopLevel(lookup.cwd);
  if (top === null) return null;
  const { project, manifest } = await projects.get(top);
  const isTask = await isTaskCheckout({ top, manifest }, id);
  if (isTask) return top;
  const taskWorktree = taskWorktreeDir(lookup.wtRoot, project.name, id);
  const exists = await files.isDir(taskWorktree);
  return exists ? taskWorktree : null;
}

async function isTaskCheckout(checkout: Checkout, id: TaskId): Promise<boolean> {
  if (path.basename(checkout.top) === id) return true;
  const branch = await git.findBranch(checkout.top);
  return branch === taskBranch(checkout.manifest.names, id);
}

/** The first `~/wt/<project>/<id>` that has a `.tenbox/` directory. */
async function worktreeUnderWtRoot(lookup: WorktreeLookup, id: TaskId): Promise<string | null> {
  const projects = await files.list(lookup.wtRoot);
  for (const project of projects) {
    const taskWorktree = taskWorktreeDir(lookup.wtRoot, project, id);
    const started = await files.isDir(path.join(taskWorktree, ".tenbox"));
    if (started) return taskWorktree;
  }
  return null;
}
