import { dirtyBeforePrError, noCommitsError } from "../../domain/errors/tasks.ts";
import { ghNoPrError } from "../../domain/errors/tools.ts";
import { type TaskId, taskBranch } from "../../domain/ids.ts";
import { checksSummary, prBody, prTitle } from "../../domain/pr.ts";
import {
  checksFile,
  planMdFile,
  roundDir,
  roundNumbers,
  roundsDir,
  tenboxDir,
} from "../../domain/task.ts";
import { files } from "../infra/files.ts";
import { gh, type OpenPr, type PrText } from "../infra/gh.ts";
import { git } from "../infra/git.ts";
import { projects } from "../application/projects.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { PrInfo, PrResult, PrState } from "./results.ts";

export interface PrInput {
  id: TaskId;
  /** Marks the PR ready for review; without it a new PR is a draft. */
  ready: boolean;
}

/** Pushes the task branch, then creates the PR or updates the open one. */
export async function openPr(input: PrInput): Promise<PrResult> {
  const { id, ready } = input;
  const taskWorktree = await worktrees.get(id);
  const { manifest } = await projects.get(taskWorktree);
  const branch = taskBranch(manifest.names, id);
  await assertPushable(taskWorktree, branch, manifest.base);
  await git.push(taskWorktree, branch);
  const commit = await git.findHead(taskWorktree);
  const text = await readPrText(id, taskWorktree);
  const pr = await createOrUpdate({ dir: taskWorktree, branch, base: manifest.base, text, ready });
  return { ok: true, task: id, branch, commit: commit ?? "", pr };
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

async function readPrText(id: TaskId, taskWorktree: string): Promise<PrText> {
  const dir = tenboxDir(taskWorktree);
  const task = await tasks.find(dir);
  const planText = await files.read(planMdFile(dir));
  const summary = await latestChecksSummary(taskWorktree);
  return {
    title: prTitle(id, task?.title ?? null),
    body: prBody(planText, summary),
  };
}

/** The `summary` of the highest round's `checks.json`; null when there is none. */
async function latestChecksSummary(taskWorktree: string): Promise<string | null> {
  const names = await files.list(roundsDir(tenboxDir(taskWorktree)));
  const latest = roundNumbers(names).at(-1);
  if (latest === undefined) return null;
  const text = await files.read(checksFile(roundDir(tenboxDir(taskWorktree), latest)));
  return checksSummary(text);
}

interface CreateOrUpdateInput {
  dir: string;
  branch: string;
  base: string;
  text: PrText;
  ready: boolean;
}

async function createOrUpdate(input: CreateOrUpdateInput): Promise<PrInfo> {
  const { dir, branch, base, text, ready } = input;
  const open = await gh.findOpen(dir, branch);
  if (open === null) {
    await gh.create(dir, { ...text, branch, base, draft: !ready });
    const created = await getOpen(dir, branch);
    return describe(created, "created");
  }
  await gh.edit(dir, open.number, text);
  if (ready && open.draft) await gh.markReady(dir, open.number);
  const updated = await getOpen(dir, branch);
  return describe(updated, "updated");
}

async function getOpen(dir: string, branch: string): Promise<OpenPr> {
  const pr = await gh.findOpen(dir, branch);
  if (pr === null) throw ghNoPrError(branch);
  return pr;
}

const describe = (pr: OpenPr, state: PrState): PrInfo => ({
  number: pr.number,
  url: pr.url,
  state,
  draft: pr.draft,
});
