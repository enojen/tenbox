import path from "node:path";
import {
  dirtyBeforeCloseError,
  inTaskWorktreeError,
  mergeCommitError,
  unmergedError,
} from "../../domain/errors/tasks.ts";
import { type TaskId, taskBranch, tmuxSessionName } from "../../domain/ids.ts";
import { taskDir, taskWorktreeDir } from "../../domain/project.ts";
import { type PrTimes, statsFile } from "../../domain/stats.ts";
import { errorMessage } from "../../domain/utils.ts";
import { projects } from "../application/projects.ts";
import { proofs } from "../application/proofs.ts";
import { type SessionRemoveState, sessions } from "../application/sessions.ts";
import { type StatsInput, stats } from "../application/stats.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { env, log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { gh } from "../infra/gh.ts";
import { git } from "../infra/git.ts";
import type { TmuxTarget } from "../infra/tmux.ts";
import { makeTracker } from "../infra/tracker/index.ts";
import type { CloseResult, PullState, RemoteBranchState, StatsInfo } from "./results.ts";

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
 * Writes `stats.json` in the task dir, kills the task's tmux server, removes the worktree and the
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
  // Read only: a project with no id yet has no task dirs and no task tmux server, and close
  // must not write the manifest.
  const projectId = manifest.id;
  const dir = projectId === undefined ? null : taskDir(tenboxHome, projectId, id);
  const target =
    projectId === undefined ? null : sessions.tmuxTarget(manifest.names, projectId, id);
  const { base } = manifest;
  const closeTarget = { mainDir: project.mainDir, taskWorktree, branch, base };
  const { mergedOnGithub, pr } = await assertSafe(closeTarget, force);
  const pull = await pullBase(closeTarget, mergedOnGithub);
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
      pr,
    };
    statsInfo = await writeStats(statsInput);
  }
  const tmuxState = await removeSession(target);
  const removed = await worktrees.remove({ project, taskWorktree, branch });
  const status = await tasks.updateStatus({ id, title: undefined }, tracker, "done");
  const remote = await removeRemoteBranch(closeTarget, mergedOnGithub);
  return {
    ok: true,
    task: id,
    project: project.name,
    forced: force,
    pull: { base, state: pull },
    stats: statsInfo,
    tmux: { session: tmuxSessionName(manifest.names, id), state: tmuxState },
    worktree: { path: taskWorktree, state: removed.worktree },
    branch: { name: branch, state: removed.branch },
    remote_branch: { name: branch, state: remote },
    tracker: { kind: tracker.kind, status },
  };
}

interface SafeClose {
  /** True when GitHub said the PR is merged. */
  mergedOnGithub: boolean;
  /** The times of the PR GitHub reported; null without one. */
  pr: PrTimes | null;
}

const NO_GITHUB: SafeClose = { mergedOnGithub: false, pr: null };

/**
 * Throws before anything changes. `force` skips the dirty, unmerged and merge-commit checks, not
 * the one for the task worktree.
 */
async function assertSafe(target: CloseTarget, force: boolean): Promise<SafeClose> {
  await assertOutsideWorktree(target.taskWorktree);
  if (force) return NO_GITHUB;
  await assertClean(target);
  return assertMerged(target);
}

/** The close removes the task worktree; a run inside it would end in a directory that is gone. */
async function assertOutsideWorktree(taskWorktree: string): Promise<void> {
  const exists = await files.isDir(taskWorktree);
  if (!exists) return;
  const real = await files.realPath(taskWorktree);
  const cwd = await files.realPath(env().cwd);
  const relative = path.relative(real, cwd);
  const outside = relative.startsWith("..") || path.isAbsolute(relative);
  if (!outside) throw inTaskWorktreeError(taskWorktree);
}

async function assertClean(target: CloseTarget): Promise<void> {
  const exists = await files.isDir(target.taskWorktree);
  if (!exists) return;
  const dirty = await git.hasChanges(target.taskWorktree);
  if (!dirty) return;
  throw dirtyBeforeCloseError(target.taskWorktree);
}

/** Throws when the branch is not merged. */
async function assertMerged(target: CloseTarget): Promise<SafeClose> {
  const merge = await findMerge(target);
  if (merge.source === "unmerged") throw unmergedError(target.branch, target.base);
  if (merge.source === "git") return NO_GITHUB;
  await assertNotMergeCommit(target, merge.commit);
  return { mergedOnGithub: true, pr: merge.pr };
}

/** A squash or rebase merge has one parent. */
async function assertNotMergeCommit({ mainDir, branch }: CloseTarget, sha: string | null) {
  if (sha === null) return;
  const parents = await gh.countParents(mainDir, sha);
  if (parents > 1) throw mergeCommitError(branch);
}

interface Merge {
  source: "github" | "git" | "unmerged";
  /** The merge commit GitHub reports; null when there is none. */
  commit: string | null;
  pr: PrTimes | null;
}

const UNMERGED: Merge = { source: "unmerged", commit: null, pr: null };
const MERGED_IN_GIT: Merge = { source: "git", commit: null, pr: null };

/** A found PR decides alone; without one, a test merge into the base decides. */
async function findMerge(target: CloseTarget): Promise<Merge> {
  const { mainDir, branch } = target;
  const head = await git.findCommit(mainDir, `refs/heads/${branch}`);
  if (head === null) return MERGED_IN_GIT; // no local branch: nothing left to merge
  const pr = await gh.findPr(mainDir, branch);
  if (pr === null) return findTestMerge(target);
  if (!gh.isMergedAt(pr, head)) return UNMERGED;
  return {
    source: "github",
    commit: pr.mergeCommit?.oid ?? null,
    pr: { createdAt: pr.createdAt, mergedAt: pr.mergedAt ?? null },
  };
}

async function findTestMerge({ mainDir, base, branch }: CloseTarget): Promise<Merge> {
  log("tenbox close: gh pr view failed, using the test merge");
  const merged = await git.isMerged(mainDir, base, branch);
  return merged ? MERGED_IN_GIT : UNMERGED;
}

/** Moves the base of the main checkout to `origin`; a failure never stops the close. */
async function pullBase(
  { mainDir, base }: CloseTarget,
  mergedOnGithub: boolean,
): Promise<PullState> {
  if (!mergedOnGithub) return "skipped";
  try {
    const current = await git.findBranch(mainDir);
    if (current !== base) return "skipped";
    await git.pull(mainDir, base);
    return "pulled";
  } catch (e) {
    return `failed: ${errorMessage(e)}`;
  }
}

/** Runs after the tracker step; a failure never undoes the close. */
async function removeRemoteBranch(
  { mainDir, branch }: CloseTarget,
  mergedOnGithub: boolean,
): Promise<RemoteBranchState> {
  if (!mergedOnGithub) return "skipped";
  try {
    const exists = await git.remoteBranchExists(mainDir, branch);
    if (!exists) return "skipped";
    await git.deleteRemoteBranch(mainDir, branch);
    return "deleted";
  } catch (e) {
    return `failed: ${errorMessage(e)}`;
  }
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

/** No target: a project with no id has no task tmux server. */
function removeSession(target: TmuxTarget | null): Promise<SessionRemoveState> {
  return target === null ? Promise.resolve("skipped") : sessions.remove(target.server);
}
