import path from "node:path";
import { TenboxError } from "../../domain/errors/index.ts";
import { isSafeName, type TaskId, taskId } from "../../domain/ids.ts";
import type { Manifest } from "../../domain/manifests.ts";
import { taskBranch } from "../../domain/names.ts";
import { roundNumbers } from "../../domain/rounds.ts";
import type {
  ListedReport,
  ReportChecks,
  ReportPr,
  StatusReport,
} from "../../domain/statusReports.ts";
import { approvedFile, checksFile, roundDir, roundsDir, tenboxDir } from "../../domain/taskDirs.ts";
import { taskWorktreeDir, taskWorktreeNames } from "../../domain/worktrees.ts";
import { env, log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { GH_STATE, gh } from "../infra/gh.ts";
import { builds } from "./builds.ts";
import { checks } from "./checks.ts";
import { parts } from "./parts.ts";
import { projects } from "./projects.ts";
import { type SessionTarget, sessions, type TargetState } from "./sessions.ts";
import { tasks } from "./tasks.ts";
import { worktrees } from "./worktrees/index.ts";

/** Status reports: where one task stands, read from its files, session and PR. */
export const statusReports = { get, list };

/** The status report of the task; `no-worktree` when it has none. */
async function get(id: TaskId): Promise<StatusReport> {
  const taskWorktree = await worktrees.get(id);
  const state = await sessions.findState({ id, taskWorktree });
  return report({ id, taskWorktree, state });
}

async function report(source: TargetState): Promise<StatusReport> {
  const { id, taskWorktree, state } = source;
  const { manifest } = await projects.get(taskWorktree);
  const dir = tenboxDir(taskWorktree);
  const build = await builds.find(dir);
  const approved = await files.exists(approvedFile(dir));
  const pr = await findPr(taskWorktree, branchOf(manifest, id));
  const roundNames = await files.list(roundsDir(dir));
  const rounds = roundNumbers(roundNames);
  const task = await tasks.find(dir);
  const partCounts = await parts.get(dir);
  const checks = await findChecks(dir, rounds);
  return {
    task: id,
    title: task?.title ?? null,
    status: task?.status ?? null,
    round: rounds.at(-1) ?? build?.round ?? null,
    approved,
    parts: partCounts,
    session: { state },
    pr,
    checks,
  };
}

const branchOf = (manifest: Manifest, id: TaskId): string => taskBranch(manifest.names, id);

/** The open PR; null without one, and when `gh` is missing or cannot answer (one stderr line). */
async function findPr(taskWorktree: string, branch: string): Promise<ReportPr | null> {
  try {
    const pr = await gh.findByBranch(taskWorktree, branch);
    if (pr === null || pr.state !== GH_STATE.open) return null;
    return { number: pr.number, url: pr.url, draft: pr.draft };
  } catch (e) {
    if (!(e instanceof TenboxError)) throw e;
    log(`tenbox status: no PR info: ${e.message}`);
    return null;
  }
}

/** The newest round that has a `checks.json`. */
async function findChecks(dir: string, rounds: number[]): Promise<ReportChecks | null> {
  for (const round of [...rounds].reverse()) {
    const result = await checks.find(checksFile(roundDir(dir, round)));
    if (result !== null) return { round, ok: result.ok, summary: result.summary };
  }
  return null;
}

/**
 * The status report of every task worktree of the project around the current directory, by id.
 * A name that is not a task id is left out; a task whose report fails gives its error.
 */
async function list(): Promise<ListedReport[]> {
  const { cwd, wtRoot } = env();
  const { project } = await projects.get(cwd);
  const dir = path.join(wtRoot, project.name);
  const names = await files.list(dir);
  const targets: SessionTarget[] = [];
  for (const name of taskWorktreeNames(names.filter(isSafeName)).sort()) {
    const id = taskId(name);
    const taskWorktree = taskWorktreeDir(wtRoot, project.name, id);
    const started = await files.isDir(tenboxDir(taskWorktree));
    if (started) targets.push({ id, taskWorktree });
  }
  const states = await sessions.findStates({ dir, targets });
  return Promise.all(states.map(listed));
}

async function listed(source: TargetState): Promise<ListedReport> {
  try {
    return await report(source);
  } catch (e) {
    if (!(e instanceof TenboxError)) throw e;
    return { task: source.id, error: e.message, code: e.code };
  }
}
