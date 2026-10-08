import path from "node:path";
import { TenboxError } from "../../domain/errors.ts";
import { type TaskId, taskBranch } from "../../domain/ids.ts";
import { checksSummary, prBody, prTitle } from "../../domain/pr.ts";
import { roundDir, roundNumbers, tenboxDir, titleFromTaskMd } from "../../domain/task.ts";
import { files } from "../../infra/files.ts";
import { gh, type OpenPr, type PrText } from "../../infra/gh.ts";
import { git } from "../../infra/git.ts";
import { projects } from "../projects.ts";
import { worktrees } from "../worktrees/index.ts";
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
    throw new TenboxError(`${taskWorktree} has uncommitted changes; commit them first`, "dirty");
  }
  const merged = await git.isMerged(taskWorktree, base, branch);
  if (merged) {
    throw new TenboxError(`${branch} has no commits ahead of ${base}`, "no-commits");
  }
}

async function readPrText(id: TaskId, taskWorktree: string): Promise<PrText> {
  const dir = tenboxDir(taskWorktree);
  const taskText = await files.read(path.join(dir, "task.md"));
  const planText = await files.read(path.join(dir, "plan.md"));
  const summary = await latestChecksSummary(taskWorktree);
  return {
    title: prTitle(id, titleFromTaskMd(taskText)),
    body: prBody(planText, summary),
  };
}

/** The `summary` of the highest round's `checks.json`; null when there is none. */
async function latestChecksSummary(taskWorktree: string): Promise<string | null> {
  const names = await files.list(path.join(tenboxDir(taskWorktree), "rounds"));
  const latest = roundNumbers(names).at(-1);
  if (latest === undefined) return null;
  const text = await files.read(path.join(roundDir(taskWorktree, latest), "checks.json"));
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
  if (pr === null) throw new TenboxError(`no open PR for ${branch} after gh ran`, "gh");
  return pr;
}

const describe = (pr: OpenPr, state: PrState): PrInfo => ({
  number: pr.number,
  url: pr.url,
  state,
  draft: pr.draft,
});
