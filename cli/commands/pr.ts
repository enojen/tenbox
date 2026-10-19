import { dirtyBeforePrError, noCommitsError } from "../../domain/errors/tasks.ts";
import { ghNoPrError } from "../../domain/errors/tools.ts";
import { type TaskId, taskBranch } from "../../domain/ids.ts";
import type { Manifest } from "../../domain/manifest.ts";
import { NOTIFICATION_STATE } from "../../domain/notifications.ts";
import {
  checksSummary,
  GROUP_PR_STATE,
  type GroupPrState,
  groupLine,
  prBody,
  prTitle,
} from "../../domain/pr.ts";
import type { Project } from "../../domain/project.ts";
import {
  checksFile,
  groupBranch,
  groupDir,
  planMdFile,
  roundDir,
  roundNumbers,
  roundsDir,
  tenboxDir,
} from "../../domain/task.ts";
import { groups } from "../application/groups.ts";
import { notifications } from "../application/notifications.ts";
import { plans } from "../application/plans.ts";
import { projects } from "../application/projects.ts";
import { prs } from "../application/prs.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { files } from "../infra/files.ts";
import { GH_STATE, type GroupPr, gh, type PrText } from "../infra/gh.ts";
import { git } from "../infra/git.ts";
import type { GroupPrResult, PrInfo, PrResult } from "./results.ts";

export interface PrInput {
  id: TaskId;
  /** Marks the PR ready for review; without it a new PR is a draft. */
  ready: boolean;
}

/** A group as `tenbox pr` sees it: a plan without groups is one group 1 with the task title. */
interface PrGroup {
  id: number;
  /** The Conventional Commits name from the plan; null for a plan without groups. */
  name: string | null;
  needs: number[];
  branch: string;
}

interface PrRun {
  input: PrInput;
  taskWorktree: string;
  baseBranch: string;
  all: PrGroup[];
  manifest: Manifest;
  project: Project;
}

/** Pushes the branch of each group whose needs are merged, then creates or updates its PR. */
export async function openPr(input: PrInput): Promise<PrResult> {
  const { id } = input;
  const taskWorktree = await worktrees.get(id);
  const { project, manifest } = await projects.get(taskWorktree);
  const all = await listGroups({ id, taskWorktree, branch: taskBranch(manifest.names, id) });
  const run: PrRun = { input, taskWorktree, baseBranch: manifest.base, all, manifest, project };
  const results: GroupPrResult[] = [];
  for (const group of all) {
    const opened = await openGroupPr({ run, group });
    results.push(opened);
  }
  return { ok: true, task: id, groups: results };
}

interface GroupListInput {
  id: TaskId;
  taskWorktree: string;
  branch: string;
}

async function listGroups(input: GroupListInput): Promise<PrGroup[]> {
  const { taskWorktree, branch } = input;
  const plan = await plans.find(tenboxDir(taskWorktree));
  if (!plan?.groups) return [{ id: 1, name: null, needs: [], branch }];
  return plan.groups.map((g) => ({
    id: g.id,
    name: g.name,
    needs: g.needs,
    branch: g.id === 1 ? branch : groupBranch(branch, g.id),
  }));
}

interface OpenGroupInput {
  run: PrRun;
  group: PrGroup;
}

async function openGroupPr(input: OpenGroupInput): Promise<GroupPrResult> {
  const { run, group } = input;
  const { id } = run.input;
  const ready = await needsMerged(input);
  if (!ready) return result(group, GROUP_PR_STATE.waiting, null);
  const checkout = await groups.ensure({
    id,
    group: group.id,
    project: run.project,
    manifest: run.manifest,
    taskWorktree: run.taskWorktree,
  });
  await assertPushable(checkout.worktree, group.branch, run.baseBranch);
  const dir = checkout.worktree;
  const own = await prs.find({ dir, id, group: group.id, branch: group.branch });
  if (own?.state === GH_STATE.merged) return result(group, GROUP_PR_STATE.merged, own);
  await git.push(dir, group.branch);
  const text = await readPrText(run, group);
  const state = await createOrUpdate({ run, group, dir, text, own });
  if (state.state === GROUP_PR_STATE.created) await notifyOpened(run, state.pr);
  return state;
}

async function needsMerged(input: OpenGroupInput): Promise<boolean> {
  const { run, group } = input;
  for (const need of group.needs) {
    const needed = run.all.find((g) => g.id === need);
    if (!needed) return false;
    const pr = await prs.find({
      dir: run.taskWorktree,
      id: run.input.id,
      group: need,
      branch: needed.branch,
    });
    if (pr?.state !== GH_STATE.merged) return false;
  }
  return true;
}

const info = (pr: GroupPr | null): PrInfo | null =>
  pr === null ? null : { number: pr.number, url: pr.url, draft: pr.draft };

const result = (group: PrGroup, state: GroupPrState, pr: GroupPr | null): GroupPrResult => ({
  group: group.id,
  branch: group.branch,
  state,
  pr: info(pr),
});

async function notifyOpened(run: PrRun, pr: PrInfo | null): Promise<void> {
  if (pr === null) return;
  const notification = { id: run.input.id, state: NOTIFICATION_STATE.prOpened, detail: pr.url };
  await notifications.send({ taskWorktree: run.taskWorktree, notification });
}

async function assertPushable(taskWorktree: string, branch: string, base: string): Promise<void> {
  const dirty = await git.hasChanges(taskWorktree);
  if (dirty) {
    throw dirtyBeforePrError(taskWorktree);
  }
  const merged = await git.isMerged(taskWorktree, base, branch);
  if (merged) {
    throw noCommitsError(branch, base);
  }
}

async function readPrText(run: PrRun, group: PrGroup): Promise<PrText> {
  const { id } = run.input;
  const dir = tenboxDir(run.taskWorktree);
  const task = await tasks.find(dir);
  const planText = await files.read(planMdFile(dir));
  const summary = await latestChecksSummary(group.id === 1 ? dir : groupDir(dir, group.id));
  return {
    title: prTitle(id, group.name ?? task?.title ?? null),
    body: prBody(groupLine(id, group.id), planText, summary),
  };
}

/** The `summary` of the highest round's `checks.json` in `dir`; null when there is none. */
async function latestChecksSummary(dir: string): Promise<string | null> {
  const names = await files.list(roundsDir(dir));
  const latest = roundNumbers(names).at(-1);
  if (latest === undefined) return null;
  const text = await files.read(checksFile(roundDir(dir, latest)));
  return checksSummary(text);
}

interface CreateOrUpdateInput {
  run: PrRun;
  group: PrGroup;
  dir: string;
  text: PrText;
  /** The PR the lookup found; a closed one is not updated. */
  own: GroupPr | null;
}

async function createOrUpdate(input: CreateOrUpdateInput): Promise<GroupPrResult> {
  const { run, group, dir, text, own } = input;
  const ready = run.input.ready;
  const base = run.baseBranch;
  const branch = group.branch;
  if (own?.state !== GH_STATE.open) {
    await gh.create(dir, { ...text, branch, base, draft: !ready });
    const created = await getPr(dir, branch);
    return result(group, GROUP_PR_STATE.created, created);
  }
  await gh.edit(dir, own.number, text);
  if (ready && own.draft) await gh.markReady(dir, own.number);
  return result(group, GROUP_PR_STATE.updated, { ...own, draft: own.draft && !ready });
}

async function getPr(dir: string, branch: string): Promise<GroupPr> {
  const pr = await gh.findByBranch(dir, branch);
  if (pr === null) throw ghNoPrError(branch);
  return pr;
}
