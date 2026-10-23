import type { CheckResult } from "../../domain/checks.ts";
import {
  checksStaleError,
  ciFailedError,
  ciTimeoutError,
  dirtyBeforePrError,
  noCommitsError,
} from "../../domain/errors/prs.ts";
import { ghNoPrError } from "../../domain/errors/tools.ts";
import { groupBranch } from "../../domain/groups.ts";
import type { TaskId } from "../../domain/ids.ts";
import type { Manifest } from "../../domain/manifests.ts";
import { taskBranch } from "../../domain/names.ts";
import { NOTIFICATION_STATE } from "../../domain/notifications.ts";
import type { Project } from "../../domain/projects.ts";
import {
  CI_STATE,
  type CiCheck,
  ciState,
  GROUP_PR_STATE,
  type GroupPrState,
  groupLine,
  prBody,
  prTitle,
} from "../../domain/prs.ts";
import { roundNumbers } from "../../domain/rounds.ts";
import {
  checksFile,
  groupRoot,
  planMdFile,
  roundDir,
  roundsDir,
  tenboxDir,
} from "../../domain/taskDirs.ts";
import { durations } from "../../domain/utils.ts";
import { checks } from "../application/checks.ts";
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
import { pollUntil } from "../infra/poll.ts";
import type { CiResult, GroupPrResult, PrInfo, PrResult } from "./results.ts";

export interface PrInput {
  id: TaskId;
  /** Marks the PR ready for review; without it a new PR is a draft. */
  ready: boolean;
  /** Pushes although the latest checks ran on another commit than HEAD, or never. */
  force: boolean;
  /** Polls the CI checks of each pushed PR until they finish. */
  wait: boolean;
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
  const done: PrResult = { ok: true, task: id, groups: results };
  if (input.wait) await waitForCi({ run, done });
  return done;
}

const CI_INTERVAL_SECONDS = 10;
const CI_DEADLINE_MINUTES = 30;
/** GitHub needs a moment to register the checks of a new push. */
const CI_REGISTER_MINUTES = 2;
const SECONDS_PER_MINUTE = 60;
const CI_INTERVAL_MS = CI_INTERVAL_SECONDS * durations.MS_PER_SECOND;
const CI_DEADLINE_MS = CI_DEADLINE_MINUTES * SECONDS_PER_MINUTE * durations.MS_PER_SECOND;
const CI_REGISTER_MS = CI_REGISTER_MINUTES * SECONDS_PER_MINUTE * durations.MS_PER_SECOND;

interface CiWaitInput {
  run: PrRun;
  done: PrResult;
}

/** Sets `ci` on each group that was pushed; a failed or late CI throws with the whole result. */
async function waitForCi(input: CiWaitInput): Promise<void> {
  const { run, done } = input;
  const started = Date.now();
  let timedOut = false;
  for (const group of done.groups) {
    const number = group.pr?.number;
    const pushed = group.state === GROUP_PR_STATE.created || group.state === GROUP_PR_STATE.updated;
    if (number === undefined || !pushed) continue;
    const latest: { checks: CiCheck[] } = { checks: [] };
    const check = async (): Promise<CiCheck[] | null> => {
      latest.checks = await gh.listChecks(run.taskWorktree, number);
      if (latest.checks.length === 0) return Date.now() - started >= CI_REGISTER_MS ? [] : null;
      return ciState(latest.checks) === CI_STATE.pending ? null : latest.checks;
    };
    const found = await pollUntil({
      check,
      deadlineMs: started + CI_DEADLINE_MS,
      intervalMs: CI_INTERVAL_MS,
    });
    const checks = found ?? latest.checks;
    const ci: CiResult = { state: ciState(checks), checks };
    group.ci = ci;
    timedOut ||= found === null;
  }
  if (done.groups.some((g) => g.ci?.state === CI_STATE.fail)) throw ciFailedError(done);
  if (timedOut) throw ciTimeoutError(done);
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
  const dir = checkout.worktree;
  await assertClean(dir);
  const own = await prs.find({ dir, id, group: group.id, branch: group.branch });
  // A squash merged branch has no commits ahead of a pulled base, so this comes first.
  if (own?.state === GH_STATE.merged) return result(group, GROUP_PR_STATE.merged, own);
  await assertAhead(dir, group.branch, run.baseBranch);
  if (!run.input.force)
    await assertChecked({ id, group: group.id, dir, taskWorktree: run.taskWorktree });
  const conflicted = await pushGroup({ run, group, dir, own });
  if (conflicted.length > 0) {
    return { ...result(group, GROUP_PR_STATE.conflict, null), files: conflicted };
  }
  const text = await readPrText(run, group);
  const state = await createOrUpdate({ run, group, dir, text, own });
  if (state.state === GROUP_PR_STATE.created) await notifyOpened(run, state.pr);
  return state;
}

interface PushInput {
  run: PrRun;
  group: PrGroup;
  dir: string;
  own: GroupPr | null;
}

/**
 * A group with needs and no PR yet waited for them: it is rebased onto the base first, so only
 * its own commits stay. Returns the conflicted files of that rebase; nothing is pushed then.
 */
async function pushGroup(input: PushInput): Promise<string[]> {
  const { run, group, dir, own } = input;
  const waited = own === null && group.needs.length > 0;
  if (!waited) {
    await git.push(dir, group.branch);
    return [];
  }
  const rebase = { taskWorktree: run.taskWorktree, group: group.id, worktree: dir };
  const conflicted = await groups.rebase({ ...rebase, base: run.baseBranch });
  if (conflicted.length > 0) return conflicted;
  await git.forcePush(dir, group.branch);
  return [];
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

async function assertClean(dir: string): Promise<void> {
  const dirty = await git.hasChanges(dir);
  if (dirty) throw dirtyBeforePrError(dir);
}

async function assertAhead(dir: string, branch: string, base: string): Promise<void> {
  const merged = await git.isMerged(dir, base, branch);
  if (merged) throw noCommitsError(branch, base);
}

export interface CheckedInput {
  id: TaskId;
  group: number;
  /** The group worktree. */
  dir: string;
  taskWorktree: string;
}

/** The latest round's checks ran on the commit that is about to be pushed. */
export async function assertChecked(input: CheckedInput): Promise<void> {
  const { id, group, dir, taskWorktree } = input;
  const head = await git.findHead(dir);
  const latest = await findLatestChecks(taskWorktree, group);
  const checked = latest?.commit ?? null;
  if (head !== null && checked === head) return;
  throw checksStaleError({ id, group, checked, head: head ?? "unknown" });
}

async function readPrText(run: PrRun, group: PrGroup): Promise<PrText> {
  const { id } = run.input;
  const dir = tenboxDir(run.taskWorktree);
  const task = await tasks.find(dir);
  const planText = await files.read(planMdFile(dir));
  const latest = await findLatestChecks(run.taskWorktree, group.id);
  const summary = latest?.summary ?? null;
  return {
    title: prTitle(id, group.name ?? task?.title ?? null),
    body: prBody(groupLine(id, group.id), planText, summary),
  };
}

/** The check result of the group's highest round; null when it has no `checks.json`. */
export async function findLatestChecks(
  taskWorktree: string,
  group: number,
): Promise<CheckResult | null> {
  const dir = groupRoot(taskWorktree, group);
  const names = await files.list(roundsDir(dir));
  const latest = roundNumbers(names).at(-1);
  if (latest === undefined) return null;
  return checks.find(checksFile(roundDir(dir, latest)));
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
