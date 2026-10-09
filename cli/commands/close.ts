import { TenboxError } from "../../domain/errors/index.ts";
import { type TaskId, taskBranch, tmuxSessionName } from "../../domain/ids.ts";
import { taskDir, taskWorktreeDir } from "../../domain/project.ts";
import { statsFile } from "../../domain/stats.ts";
import { errorMessage } from "../../domain/utils.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { makeTracker } from "../infra/tracker/index.ts";
import { projects } from "../application/projects.ts";
import { proofs } from "../application/proofs.ts";
import { sessions } from "../application/sessions.ts";
import { type StatsInput, stats } from "../application/stats.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { CloseResult, StatsInfo } from "./results.ts";

export interface CloseInput {
  id: TaskId;
  /** Closes a task with uncommitted changes or commits that are not on `main`. */
  force: boolean;
}

const SKIPPED_STATS: StatsInfo = { path: null, state: "skipped" };

interface CloseTarget {
  mainDir: string;
  taskWorktree: string;
  branch: string;
  base: string;
}

/**
 * Writes `stats.json` in the task dir, kills the tmux session, removes the worktree and the
 * branch, sets the tracker to done. The task dir stays. The safety checks run first; a step with
 * nothing to do is skipped.
 */
export async function closeTask(input: CloseInput): Promise<CloseResult> {
  const { id, force } = input;
  const { cwd, wtRoot, tenboxHome } = env();
  const { project, manifest } = await projects.get(cwd);
  const tracker = makeTracker(manifest.tracker);
  const taskWorktree = taskWorktreeDir(wtRoot, project.name, id);
  const branch = taskBranch(manifest.names, id);
  const session = tmuxSessionName(manifest.names, id);
  // Read only: a project with no id yet has no task dirs, and close must not write the manifest.
  const dir = manifest.id === undefined ? null : taskDir(tenboxHome, manifest.id, id);
  const { base } = manifest;
  await assertSafe({ mainDir: project.mainDir, taskWorktree, branch, base }, force);
  const recordedProofs = await proofs.read(taskWorktree);
  let statsInfo = SKIPPED_STATS;
  if (dir !== null) {
    const statsInput: StatsInput = {
      id,
      project: project.name,
      forced: force,
      mainDir: project.mainDir,
      taskWorktree,
      taskDir: dir,
      branch,
      base,
      recordedProofs,
    };
    statsInfo = await writeStats(statsInput);
  }
  const tmuxState = await sessions.remove(session);
  const removed = await worktrees.remove({ project, taskWorktree, branch });
  const status = await tasks.updateStatus({ id, title: undefined }, tracker, "done");
  return {
    ok: true,
    task: id,
    project: project.name,
    forced: force,
    stats: statsInfo,
    tmux: { session, state: tmuxState },
    worktree: { path: taskWorktree, state: removed.worktree },
    branch: { name: branch, state: removed.branch },
    tracker: { kind: tracker.kind, status },
  };
}

/** Throws before anything changes. `force` skips the dirty and unmerged checks only. */
async function assertSafe(target: CloseTarget, force: boolean): Promise<void> {
  if (force) return;
  await assertClean(target);
  await assertMerged(target);
}

async function assertClean(target: CloseTarget): Promise<void> {
  const exists = await files.isDir(target.taskWorktree);
  if (!exists) return;
  const dirty = await git.hasChanges(target.taskWorktree);
  if (!dirty) return;
  throw new TenboxError(
    `${target.taskWorktree} has uncommitted changes; commit them or pass --force`,
    "dirty",
  );
}

async function assertMerged(target: CloseTarget): Promise<void> {
  const { mainDir, branch, base } = target;
  const exists = await git.branchExists(mainDir, branch);
  if (!exists) return;
  const merged = await git.isMerged(mainDir, base, branch);
  if (merged) return;
  throw new TenboxError(
    `${branch} has changes that are not on ${base}; merge it or pass --force`,
    "unmerged",
  );
}

/** Runs before the worktree and branch are gone; a failure never stops the close. */
async function writeStats(input: StatsInput): Promise<StatsInfo> {
  const hasDir = await files.isDir(input.taskDir);
  const hasWorktree = await files.isDir(input.taskWorktree);
  if (!hasDir || !hasWorktree) return SKIPPED_STATS;
  const file = statsFile(input.taskDir);
  try {
    const computed = await stats.compute(input);
    await stats.save(computed, input.taskDir);
    return { path: file, state: "written" };
  } catch (e) {
    return { path: file, state: `failed: ${errorMessage(e)}` };
  }
}
