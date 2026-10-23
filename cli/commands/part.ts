import { noBaseError } from "../../domain/errors/index.ts";
import { partNotCommittedError, unknownPartError } from "../../domain/errors/plans.ts";
import type { TaskId } from "../../domain/ids.ts";
import { tenboxDir } from "../../domain/taskDirs.ts";
import { groups } from "../application/groups.ts";
import { plans } from "../application/plans.ts";
import { projects } from "../application/projects.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { git } from "../infra/git.ts";
import type { PartDoneResult } from "./results.ts";

export interface PartDoneInput {
  id: TaskId;
  part: string;
  commit: string | undefined;
  /** Default: the merge-base of HEAD and the manifest's `base`. */
  since: string | undefined;
  group: number | undefined;
}

/** What the commit is checked in: the worktree, the part's pathspecs and the commit it must follow. */
interface Scope {
  cwd: string;
  paths: string[];
  since: string;
}

const WHOLE_WORKTREE = ["."];

/** Checks that the worker's commit holds the part: new, on HEAD, touching its files, nothing left over. */
export async function partDone(input: PartDoneInput): Promise<PartDoneResult> {
  const { id, part } = input;
  const scope = await getScope(input);
  const commit = await getCommit(input, scope);
  const { cwd, paths, since } = scope;
  const changed = await git.listChangedPaths(cwd, { from: since, to: commit }, paths);
  if (changed.length === 0)
    throw partNotCommittedError(part, "the commit changes none of its files");
  const dirty = await git.listDirtyPaths(cwd, paths);
  if (dirty.length > 0) {
    throw partNotCommittedError(part, `uncommitted changes in ${dirty.join(", ")}`);
  }
  return { ok: true, task: id, part, commit };
}

async function getScope(input: PartDoneInput): Promise<Scope> {
  const { id, part } = input;
  const taskWorktree = await worktrees.get(id);
  const plan = await plans.find(tenboxDir(taskWorktree));
  const found = plan?.parts.find((candidate) => candidate.id === part);
  if (!found) throw unknownPartError(part);
  const { project, manifest } = await projects.get(taskWorktree);
  const group = input.group ?? 1;
  const checkout = await groups.ensure({ id, group, project, manifest, taskWorktree });
  const cwd = checkout.worktree;
  const since = await findSince(input, { cwd, base: manifest.base });
  if (since === null) throw noBaseError(manifest.base, "has no common ancestor with HEAD");
  const paths = found.files && found.files.length > 0 ? found.files : WHOLE_WORKTREE;
  return { cwd, paths, since };
}

interface SinceWhere {
  cwd: string;
  base: string;
}

function findSince(input: PartDoneInput, where: SinceWhere): Promise<string | null> {
  if (input.since) return Promise.resolve(input.since);
  return git.findMergeBase(where.cwd, where.base);
}

/** The full sha of the commit; fails when it is missing, not on HEAD or not after `since`. */
async function getCommit(input: PartDoneInput, scope: Scope): Promise<string> {
  const { part, commit: given } = input;
  const { cwd, since } = scope;
  if (!given) throw partNotCommittedError(part, "the worker gave no commit");
  const commit = await git.findCommit(cwd, `${given}^{commit}`);
  if (commit === null) throw partNotCommittedError(part, `commit ${given} not found`);
  const onHead = await git.isAncestor(cwd, commit, "HEAD");
  if (!onHead) throw partNotCommittedError(part, `commit ${given} is not on HEAD`);
  const old = await isNotAfter({ cwd, commit, since });
  if (old) throw partNotCommittedError(part, `commit ${given} is not new after ${since}`);
  return commit;
}

interface NotAfter {
  cwd: string;
  commit: string;
  since: string;
}

async function isNotAfter(input: NotAfter): Promise<boolean> {
  const { cwd, commit, since } = input;
  const sinceSha = await git.findCommit(cwd, `${since}^{commit}`);
  if (sinceSha === null) return false;
  return git.isAncestor(cwd, commit, sinceSha);
}
