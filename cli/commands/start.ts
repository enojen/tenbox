import { TenboxError } from "../../domain/errors/index.ts";
import { taskInProgressError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import type { TaskKind } from "../../domain/kinds.ts";
import { taskDir } from "../../domain/taskDirs.ts";
import { TASK_STATUS } from "../../domain/tracker.ts";
import { sessionName, taskBranch, taskWorktreeDir } from "../../domain/worktrees.ts";
import { manifests } from "../application/manifests.ts";
import { plans } from "../application/plans.ts";
import { projects } from "../application/projects.ts";
import { sessions } from "../application/sessions.ts";
import { setups } from "../application/setups.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { env, log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { GH_STATE, gh } from "../infra/gh.ts";
import { git } from "../infra/git.ts";
import { makeTracker } from "../infra/tracker/index.ts";
import type { StartResult } from "./results.ts";

export interface StartInput {
  id: TaskId;
  /** With a title, no tracker is needed. */
  title: string | undefined;
  /** Default: the manifest's `base`. */
  base: string | undefined;
  /** `--kind`: saved in `task.json`; `docs` writes the plan and starts no planner. */
  kind: TaskKind | undefined;
  /** False with `--no-claude`: no background `claude` with the plan. */
  claude: boolean;
  setup: boolean;
  /** `--force`: start even when the task branch is on `origin`. */
  force: boolean;
}

/** Worktree + branch from `base`, task dir with `task.md` linked as `.tenbox`, setup, then `claude --bg` with the plan in the task worktree. */
export async function startTask(input: StartInput): Promise<StartResult> {
  const { id, kind } = input;
  const { project, manifest } = await projects.get(env().cwd);
  const projectId = await manifests.ensureId(project.mainDir);
  const base = input.base ?? manifest.base;
  await manifests.requireCommitted(project.mainDir, base);
  const tracker = makeTracker(manifest.tracker);
  const task = await tasks.get(input, tracker);
  const taskWorktree = taskWorktreeDir(env().wtRoot, project.name, id);
  const branch = taskBranch(manifest.names, id);
  const { tenboxHome } = env();
  await projects.save(tenboxHome, { id: projectId, name: project.name });
  const dir = taskDir(tenboxHome, projectId, id);
  if (!input.force)
    await assertNotInProgress({ id, mainDir: project.mainDir, taskWorktree, branch });
  const created = await worktrees.ensure({ project, taskWorktree, taskDir: dir, branch, base });
  const task_md = await tasks.ensureFiles(taskWorktree, task, kind);
  if (kind === "docs") await plans.ensureDocs(taskWorktree, task);
  const setup = await setups.run(taskWorktree, manifest.setup, input.setup);
  const status = await tasks.updateStatus(input, tracker, TASK_STATUS.inProgress);
  const claude = await sessions.ensure({
    target: { id, taskWorktree },
    start: {
      id,
      model: manifest.model,
      addDir: dir,
      name: sessionName(manifest.names, id),
      prompt: `/tenbox-plan ${id}`,
    },
    enabled: input.claude && kind !== "docs",
  });
  return {
    ok: true,
    task: id,
    title: task.title,
    project: project.name,
    worktree: taskWorktree,
    branch,
    base,
    created,
    task_md,
    setup,
    tracker: { kind: tracker.kind, status },
    claude,
  };
}

interface ProgressTarget {
  id: TaskId;
  mainDir: string;
  taskWorktree: string;
  branch: string;
}

/**
 * A new task worktree whose branch is already on `origin` would work beside another run:
 * `task-in-progress`, with the open PR of that branch when `gh` finds one. A worktree that
 * exists is this run's own; a project without `origin` has no other run.
 */
async function assertNotInProgress(target: ProgressTarget): Promise<void> {
  const { id, mainDir, taskWorktree, branch } = target;
  const exists = await files.isDir(taskWorktree);
  if (exists) return;
  const origin = await git.findRemoteUrl(mainDir);
  if (origin === null) return;
  const onOrigin = await findOnOrigin(mainDir, branch);
  if (!onOrigin) return;
  const pr = await findOpenPr(mainDir, branch);
  throw taskInProgressError(id, branch, pr);
}

/** A failed `ls-remote` is one stderr line and counts as no branch, as a failed fetch does. */
async function findOnOrigin(mainDir: string, branch: string): Promise<boolean> {
  try {
    return await git.remoteBranchExists(mainDir, branch);
  } catch (e) {
    if (!(e instanceof TenboxError)) throw e;
    log(`tenbox start: git ls-remote origin ${branch} failed (${e.message}), not checked`);
    return false;
  }
}

/** The URL of the open PR of the branch; null without one or when `gh` cannot answer. */
async function findOpenPr(mainDir: string, branch: string): Promise<string | null> {
  try {
    const pr = await gh.findByBranch(mainDir, branch);
    return pr?.state === GH_STATE.open ? pr.url : null;
  } catch (e) {
    if (!(e instanceof TenboxError)) throw e;
    log(`tenbox start: no PR info: ${e.message}`);
    return null;
  }
}
