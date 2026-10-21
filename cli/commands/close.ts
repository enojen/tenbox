import path from "node:path";
import {
  dirtyBeforeCloseError,
  inTaskWorktreeError,
  mergeCommitError,
  unmergedError,
} from "../../domain/errors/tasks.ts";
import { type TaskId, taskBranch } from "../../domain/ids.ts";
import { TRACKER_KIND } from "../../domain/manifest.ts";
import { type Project, taskDir, taskWorktreeDir } from "../../domain/project.ts";
import { costComment, type PrTimes, statsFile, type TaskStats } from "../../domain/stats.ts";
import { tenboxDir } from "../../domain/task.ts";
import { TASK_STATUS, type Tracker } from "../../domain/tracker.ts";
import { errorMessage, failedState } from "../../domain/utils.ts";
import { type ExtraGroup, groups } from "../application/groups.ts";
import { projects } from "../application/projects.ts";
import { proofs } from "../application/proofs.ts";
import { prs } from "../application/prs.ts";
import { sessions } from "../application/sessions.ts";
import { type StatsInput, stats } from "../application/stats.ts";
import { tasks } from "../application/tasks.ts";
import {
  type BranchRemoveState,
  type WorktreeRemoveState,
  worktrees,
} from "../application/worktrees/index.ts";
import { env, log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { gh } from "../infra/gh.ts";
import { git } from "../infra/git.ts";
import { makeTracker } from "../infra/tracker/index.ts";
import type {
  CloseResult,
  CommentState,
  GroupCloseResult,
  PullState,
  RemoteBranchState,
  SessionState,
  StatsInfo,
} from "./results.ts";

export interface CloseInput {
  id: TaskId;
  /** Closes a task with uncommitted changes or commits that are not on `main`. */
  force: boolean;
}

/** What the close did with `stats.json`. */
export const STATS_STATE = { written: "written", skipped: "skipped" } as const;

/** What the close did with the base of the main checkout. */
export const PULL_STATE = { pulled: "pulled", skipped: "skipped" } as const;

/** What the close did with the task branch on `origin`. */
export const REMOTE_BRANCH_STATE = { deleted: "deleted", skipped: "skipped" } as const;

/** What the close did with the cost comment on the tracker task. */
export const COMMENT_STATE = { posted: "posted", skipped: "skipped" } as const;

/** Who says the branch is merged: GitHub, a test merge in git, or nobody. */
const MERGE_SOURCE = { github: "github", git: "git", unmerged: "unmerged" } as const;

const SKIPPED_STATS: StatsInfo = { path: null, state: STATS_STATE.skipped };

interface CloseTarget {
  mainDir: string;
  taskWorktree: string;
  branch: string;
  base: string;
}

/**
 * Writes `stats.json` in the task dir, stops the task's background sessions, removes the worktree and the
 * branch, sets the tracker to done and posts the cost comment. The task dir stays. The safety checks run first; a step with
 * nothing to do is skipped.
 */
export async function closeTask(input: CloseInput): Promise<CloseResult> {
  const { id, force } = input;
  const { cwd, wtRoot, tenboxHome } = env();
  const { project, manifest } = await projects.get(cwd);
  const tracker = makeTracker(manifest.tracker);
  const taskWorktree = taskWorktreeDir(wtRoot, project.name, id);
  const branch = taskBranch(manifest.names, id);
  // Read only: a project with no id yet has no task dirs, and close must not write the manifest.
  const projectId = manifest.id;
  const dir = projectId === undefined ? null : taskDir(tenboxHome, projectId, id);
  const { base } = manifest;
  const closeTarget = { mainDir: project.mainDir, taskWorktree, branch, base };
  const extra = await groups.listExtra({
    planDir: dir ?? tenboxDir(taskWorktree),
    taskWorktree,
    taskBranch: branch,
  });
  const safe: SafeInput = { target: closeTarget, id, extra, force };
  const { mergedOnGithub, pr, groupTargets } = await assertSafe(safe);
  const pull = await pullBase(closeTarget, mergedOnGithub);
  const recordedProofs = await proofs.read(taskWorktree);
  let written: WrittenStats = { info: SKIPPED_STATS, stats: null };
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
    written = await writeStats(statsInput);
  }
  const session = await stopSessions({ id, taskWorktree });
  const removedGroups = await removeGroupCheckouts(project, groupTargets);
  const removed = await worktrees.remove({ project, taskWorktree, branch });
  const status = await tasks.updateStatus({ id, title: undefined }, tracker, TASK_STATUS.done);
  const remote = await removeRemoteBranch(closeTarget, mergedOnGithub);
  const closedGroups = await removeGroupRemotes(closeTarget, removedGroups);
  const comment = await postComment({ id, tracker, stats: written.stats });
  return {
    ok: true,
    task: id,
    project: project.name,
    forced: force,
    pull: { base, state: pull },
    stats: written.info,
    session: { state: session },
    worktree: { path: taskWorktree, state: removed.worktree },
    branch: { name: branch, state: removed.branch },
    remote_branch: { name: branch, state: remote },
    ...(closedGroups.length > 0 && { groups: closedGroups }),
    tracker: { kind: tracker.kind, status },
    comment: { state: comment },
  };
}

interface SafeClose {
  /** True when GitHub said the PR is merged. */
  mergedOnGithub: boolean;
  /** The times of the PR GitHub reported; null without one. */
  pr: PrTimes | null;
  /** The groups above 1 with the branch their PR names; empty for a task without groups. */
  groupTargets: GroupTarget[];
}

interface GroupTarget extends ExtraGroup {
  mergedOnGithub: boolean;
}

type TaskSafe = Pick<SafeClose, "mergedOnGithub" | "pr">;

const NO_GITHUB: TaskSafe = { mergedOnGithub: false, pr: null };

interface SafeInput {
  target: CloseTarget;
  id: TaskId;
  extra: ExtraGroup[];
  force: boolean;
}

/**
 * Throws before anything changes. `force` skips the dirty, unmerged and merge-commit checks, not
 * the one for the task worktree.
 */
async function assertSafe(input: SafeInput): Promise<SafeClose> {
  const { target, id, extra, force } = input;
  await assertOutsideWorktree(target.taskWorktree);
  if (force) {
    const forced = extra.map((g) => ({ ...g, mergedOnGithub: false }));
    return { ...NO_GITHUB, groupTargets: forced };
  }
  await assertClean(target);
  const task = await assertMerged(target, target.branch);
  const groupTargets: GroupTarget[] = [];
  for (const g of extra) {
    const checked = await assertGroupMerged(target, id, g);
    groupTargets.push(checked);
  }
  return { ...task, groupTargets };
}

/** The PR of the group names its branch; its worktree is clean and its PR is merged at the head. */
async function assertGroupMerged(
  target: CloseTarget,
  id: TaskId,
  g: ExtraGroup,
): Promise<GroupTarget> {
  const found = await prs.find({ dir: target.mainDir, id, group: g.group, branch: g.branch });
  const branch = found?.branch ?? g.branch;
  const own = { ...target, taskWorktree: g.worktree, branch };
  await assertClean(own);
  const merged = await assertMerged(own, `group ${g.group} (${branch})`);
  return { ...g, branch, mergedOnGithub: merged.mergedOnGithub };
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

/** Throws when the branch is not merged; `label` names it in the error. */
async function assertMerged(target: CloseTarget, label: string): Promise<TaskSafe> {
  const merge = await findMerge(target);
  if (merge.source === MERGE_SOURCE.unmerged) throw unmergedError(label, target.base);
  if (merge.source === MERGE_SOURCE.git) return NO_GITHUB;
  await assertNotMergeCommit(target, merge.commit);
  return { mergedOnGithub: true, pr: merge.pr };
}

/** A squash or rebase merge has one parent; a merge commit counts when the head is in the base. */
async function assertNotMergeCommit(target: CloseTarget, sha: string | null) {
  if (sha === null) return;
  const parents = await gh.countParents(target.mainDir, sha);
  if (parents <= 1) return;
  const { mainDir, branch, base } = target;
  const head = await git.findCommit(mainDir, `refs/heads/${branch}`);
  const remote = `origin/${base}`;
  const reason = await headNotInBase(mainDir, head, remote);
  if (reason !== null) throw mergeCommitError({ branch, base: remote, reason });
}

/** Fetches `origin`; null when `head` is in `remote`, else why it is not known to be. */
async function headNotInBase(
  mainDir: string,
  head: string | null,
  remote: string,
): Promise<string | null> {
  try {
    await git.fetch(mainDir);
  } catch (e) {
    return `git fetch origin failed (${errorMessage(e)})`;
  }
  if (head === null) return `its branch head is not known, so it is not in ${remote}`;
  const inBase = await git.isAncestor(mainDir, head, remote);
  return inBase ? null : `its branch head is not in ${remote}`;
}

interface Merge {
  source: (typeof MERGE_SOURCE)[keyof typeof MERGE_SOURCE];
  /** The merge commit GitHub reports; null when there is none. */
  commit: string | null;
  pr: PrTimes | null;
}

const UNMERGED: Merge = { source: MERGE_SOURCE.unmerged, commit: null, pr: null };
const MERGED_IN_GIT: Merge = { source: MERGE_SOURCE.git, commit: null, pr: null };

/** A found PR decides alone; without one, a test merge into the base decides. */
async function findMerge(target: CloseTarget): Promise<Merge> {
  const { mainDir, branch } = target;
  const head = await git.findCommit(mainDir, `refs/heads/${branch}`);
  if (head === null) return MERGED_IN_GIT; // no local branch: nothing left to merge
  const pr = await gh.findPr(mainDir, branch);
  if (pr === null) return findTestMerge(target);
  if (!gh.isMergedAt(pr, head)) return UNMERGED;
  return {
    source: MERGE_SOURCE.github,
    commit: pr.mergeCommit?.oid ?? null,
    pr: { createdAt: pr.createdAt, mergedAt: pr.mergedAt ?? null },
  };
}

async function findTestMerge(target: CloseTarget): Promise<Merge> {
  log("tenbox close: gh pr view failed, using the test merge");
  const merged = await git.isMerged(target.mainDir, target.base, target.branch);
  return merged ? MERGED_IN_GIT : UNMERGED;
}

/** Moves the base of the main checkout to `origin`; a failure never stops the close. */
async function pullBase(target: CloseTarget, mergedOnGithub: boolean): Promise<PullState> {
  const { mainDir, base } = target;
  if (!mergedOnGithub) return PULL_STATE.skipped;
  try {
    const current = await git.findBranch(mainDir);
    if (current !== base) return PULL_STATE.skipped;
    await git.pull(mainDir, base);
    return PULL_STATE.pulled;
  } catch (e) {
    return failedState(e);
  }
}

/** Runs after the tracker step; a failure never undoes the close. */
async function removeRemoteBranch(
  target: CloseTarget,
  mergedOnGithub: boolean,
): Promise<RemoteBranchState> {
  const { mainDir, branch } = target;
  if (!mergedOnGithub) return REMOTE_BRANCH_STATE.skipped;
  try {
    const exists = await git.remoteBranchExists(mainDir, branch);
    if (!exists) return REMOTE_BRANCH_STATE.skipped;
    await git.deleteRemoteBranch(mainDir, branch);
    return REMOTE_BRANCH_STATE.deleted;
  } catch (e) {
    return failedState(e);
  }
}

interface WrittenStats {
  info: StatsInfo;
  /** The record that was written; null when nothing was. */
  stats: TaskStats | null;
}

/** Runs before the worktree and branch are gone; a failure never stops the close. */
async function writeStats(input: StatsInput): Promise<WrittenStats> {
  const hasDir = await files.isDir(input.taskDir);
  const hasWorktree = await files.isDir(input.taskWorktree);
  if (!hasDir || !hasWorktree) return { info: SKIPPED_STATS, stats: null };
  const file = statsFile(input.taskDir);
  try {
    const computed = await stats.compute(input);
    await stats.save(computed, input.taskDir);
    return { info: { path: file, state: STATS_STATE.written }, stats: computed };
  } catch (e) {
    return { info: { path: file, state: failedState(e) }, stats: null };
  }
}

interface SessionTarget {
  id: TaskId;
  taskWorktree: string;
}

/** A `claude` that fails must not stop the close: the worktree and branch still go. */
async function stopSessions(target: SessionTarget): Promise<SessionState> {
  try {
    return await sessions.stop(target);
  } catch (e) {
    return failedState(e);
  }
}

interface CommentInput {
  id: TaskId;
  tracker: Tracker;
  stats: TaskStats | null;
}

/** Needs the stats the close wrote; a failure never undoes the close. */
async function postComment(input: CommentInput): Promise<CommentState> {
  const { id, tracker, stats } = input;
  if (stats === null || tracker.kind === TRACKER_KIND.none) return COMMENT_STATE.skipped;
  try {
    await tracker.comment({ id, text: costComment(stats) });
    return COMMENT_STATE.posted;
  } catch (e) {
    return failedState(e);
  }
}

interface RemovedGroup extends GroupTarget {
  worktreeState: WorktreeRemoveState;
  branchState: BranchRemoveState;
}

/** Each group worktree and its local branch, before the task worktree. */
async function removeGroupCheckouts(
  project: Project,
  targets: GroupTarget[],
): Promise<RemovedGroup[]> {
  const removed: RemovedGroup[] = [];
  for (const g of targets) {
    const states = await worktrees.remove({ project, taskWorktree: g.worktree, branch: g.branch });
    removed.push({ ...g, worktreeState: states.worktree, branchState: states.branch });
  }
  return removed;
}

/** The remote branch of each group, after the tracker step; a failure never undoes the close. */
async function removeGroupRemotes(
  target: CloseTarget,
  removed: RemovedGroup[],
): Promise<GroupCloseResult[]> {
  const results: GroupCloseResult[] = [];
  for (const g of removed) {
    const remote = await removeRemoteBranch({ ...target, branch: g.branch }, g.mergedOnGithub);
    results.push({
      group: g.group,
      worktree: { path: g.worktree, state: g.worktreeState },
      branch: { name: g.branch, state: g.branchState },
      remote_branch: { name: g.branch, state: remote },
    });
  }
  return results;
}
