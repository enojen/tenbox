import { mergeConflictError, newFailuresError } from "../../domain/errors/git.ts";
import { noBaseError } from "../../domain/errors/index.ts";
import { noChecksError } from "../../domain/errors/manifest.ts";
import { isTaskBranch } from "../../domain/ids.ts";
import type { Project } from "../../domain/project.ts";
import { checks } from "../application/checks.ts";
import { manifests } from "../application/manifests.ts";
import { projects } from "../application/projects.ts";
import { setups } from "../application/setups.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { gh, type PrBranch } from "../infra/gh.ts";
import { git } from "../infra/git.ts";
import type { CheckOutcome, MergeCheckResult } from "./results.ts";

export interface MergeCheckInput {
  /** Default: the manifest's `base`. */
  base: string | undefined;
  timeoutMs: number;
}

interface BaseRef {
  ref: string;
  sha: string;
}

/** What the merge and the checks need to know about the open task PRs. */
interface Merge {
  project: Project;
  base: BaseRef;
  prs: PrBranch[];
  /** The branches by PR number, lowest first: the merge order. */
  order: string[];
  timeoutMs: number;
}

const TEMP_PREFIX = "tenbox-merge-check-";
const byNumber = (a: PrBranch, b: PrBranch): number => a.number - b.number;

/**
 * Merges the open task PR branches onto the base in a temporary worktree and runs setup and
 * every check of both tiers there, so a break that git does not see (a type error) shows before the merge.
 */
export async function mergeCheck(input: MergeCheckInput): Promise<MergeCheckResult> {
  const { project, manifest } = await projects.get(process.cwd());
  const baseName = input.base ?? manifest.base;
  await git.fetch(project.mainDir);
  const base = await findBase(project, baseName);
  const open = await gh.listOpen(project.mainDir, baseName);
  const prs = open.filter((pr) => isTaskBranch(manifest.names, pr.branch));
  const order = [...prs].sort(byNumber).map((pr) => pr.branch);
  const merge = { project, base, prs, order, timeoutMs: input.timeoutMs };
  if (prs.length === 0) return buildResult(merge, []);
  const outcomes = await inTempWorktree(merge);
  const result = buildResult(merge, outcomes);
  if (!result.ok) throw newFailuresError(result);
  return result;
}

async function findBase(project: Project, name: string): Promise<BaseRef> {
  const ref = `origin/${name}`;
  const sha = await git.findCommit(project.mainDir, ref);
  if (sha === null) throw noBaseError(ref, "not found");
  return { ref, sha };
}

/** The worktree is removed on every way out: success, a conflict, a failed setup, an error. */
async function inTempWorktree(merge: Merge): Promise<CheckOutcome[]> {
  const { mainDir } = merge.project;
  const dir = await files.makeTempDir(TEMP_PREFIX);
  try {
    await git.addDetachedWorktree(mainDir, dir, merge.base.ref);
    await mergeAll(merge, dir);
    return await setupAndCheck(merge, dir);
  } finally {
    await files.remove(dir);
    await git.pruneWorktrees(mainDir);
  }
}

async function mergeAll(merge: Merge, dir: string): Promise<void> {
  for (const branch of merge.order) {
    const conflicted = await git.merge(dir, `origin/${branch}`);
    if (conflicted.length === 0) continue;
    const { base, prs, order } = merge;
    throw mergeConflictError(branch, { base, prs, order, conflict: { branch, files: conflicted } });
  }
}

async function setupAndCheck(merge: Merge, dir: string): Promise<CheckOutcome[]> {
  const { project, base, timeoutMs } = merge;
  const manifest = await manifests.get(project.mainDir, dir);
  const everyCheck = { ...manifest.checks.fast, ...manifest.checks.full };
  if (Object.keys(everyCheck).length === 0) throw noChecksError();
  await setups.run(dir, manifest.setup, true);
  const pattern = manifest.failure_pattern ?? env().failurePattern;
  const outcomes: CheckOutcome[] = [];
  for (const [name, cmd] of Object.entries(everyCheck)) {
    const request = { project, cwd: dir, name, cmd, pattern, baseSha: base.sha, timeoutMs };
    const { outcome } = await checks.run(request);
    outcomes.push(outcome);
  }
  return outcomes;
}

function buildResult(merge: Merge, outcomes: CheckOutcome[]): MergeCheckResult {
  return {
    ok: outcomes.every((o) => o.new_failures.length === 0),
    base: merge.base,
    prs: merge.prs,
    order: merge.order,
    checks: outcomes,
    summary: checks.summarize(outcomes),
  };
}
