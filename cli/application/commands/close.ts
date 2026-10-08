import { TenboxError } from "../../domain/errors.ts";
import { type TaskId, taskBranch, tmuxSessionName } from "../../domain/ids.ts";
import { archiveDir, taskWorktreeDir } from "../../domain/project.ts";
import { statsFile } from "../../domain/stats.ts";
import { tenboxDir } from "../../domain/task.ts";
import { errorMessage } from "../../domain/utils.ts";
import { env } from "../../infra/env.ts";
import { files } from "../../infra/files.ts";
import { git } from "../../infra/git.ts";
import { makeTracker } from "../../infra/tracker/index.ts";
import { projects } from "../projects.ts";
import { sessions } from "../sessions.ts";
import { type StatsInput, stats } from "../stats.ts";
import { tasks } from "../tasks.ts";
import { worktrees } from "../worktrees/index.ts";
import type { ArchiveState, CloseResult, StatsInfo } from "./results.ts";

export interface CloseInput {
  id: TaskId;
  /** Closes a task with uncommitted changes or commits that are not on `main`. */
  force: boolean;
}

interface CloseTarget {
  mainDir: string;
  taskWorktree: string;
  branch: string;
  archive: string;
}

const CLOSE_BASE = "main";

/**
 * Archives `.tenbox/`, kills the tmux session, removes the worktree and the branch, sets the
 * tracker to done. The safety checks run first; a step with nothing to do is skipped.
 */
export async function closeTask(input: CloseInput): Promise<CloseResult> {
  const { id, force } = input;
  const { cwd, wtRoot } = env();
  const { project, manifest } = await projects.get(cwd);
  const tracker = makeTracker(manifest.tracker);
  const taskWorktree = taskWorktreeDir(wtRoot, project.name, id);
  const branch = taskBranch(manifest.names, id);
  const session = tmuxSessionName(manifest.names, id);
  const archive = archiveDir(wtRoot, project.name, id);
  await assertSafe({ mainDir: project.mainDir, taskWorktree, branch, archive }, force);
  const archiveState = await tasks.removeFiles(taskWorktree, archive);
  const statsInput: StatsInput = {
    id,
    project: project.name,
    forced: force,
    mainDir: project.mainDir,
    taskWorktree,
    archive,
    branch,
    base: CLOSE_BASE,
  };
  const statsInfo = await writeStats(statsInput, archiveState);
  const tmuxState = await sessions.remove(session);
  const removed = await worktrees.remove({ project, taskWorktree, branch });
  const status = await tasks.updateStatus({ id }, tracker, "done");
  return {
    ok: true,
    task: id,
    project: project.name,
    forced: force,
    archive: { path: archive, state: archiveState },
    stats: statsInfo,
    tmux: { session, state: tmuxState },
    worktree: { path: taskWorktree, state: removed.worktree },
    branch: { name: branch, state: removed.branch },
    tracker: { kind: tracker.kind, status },
  };
}

/** Throws before anything changes. `force` skips the dirty and unmerged checks only. */
async function assertSafe(target: CloseTarget, force: boolean): Promise<void> {
  await assertArchiveFree(target);
  if (force) return;
  await assertClean(target);
  await assertMerged(target);
}

async function assertArchiveFree(target: CloseTarget): Promise<void> {
  const hasFiles = await files.isDir(tenboxDir(target.taskWorktree));
  if (!hasFiles) return;
  const taken = await files.exists(target.archive);
  if (!taken) return;
  throw new TenboxError(`archive ${target.archive} already exists; move it away`, "archive-exists");
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
  const { mainDir, branch } = target;
  const exists = await git.branchExists(mainDir, branch);
  if (!exists) return;
  const merged = await git.isMerged(mainDir, CLOSE_BASE, branch);
  if (merged) return;
  throw new TenboxError(
    `${branch} has changes that are not on ${CLOSE_BASE}; merge it or pass --force`,
    "unmerged",
  );
}

/** Runs after the archive move and before the branch is gone; a failure never stops the close. */
async function writeStats(input: StatsInput, archiveState: ArchiveState): Promise<StatsInfo> {
  const file = statsFile(input.archive);
  if (archiveState === "skipped") return { path: file, state: "skipped" };
  try {
    const computed = await stats.compute(input);
    await stats.save(computed, input.archive);
    return { path: file, state: "written" };
  } catch (e) {
    return { path: file, state: `failed: ${errorMessage(e)}` };
  }
}
