import { type TaskId, taskBranch, tmuxSessionName } from "../../domain/ids.ts";
import { taskDir, taskWorktreeDir } from "../../domain/project.ts";
import { env } from "../infra/env.ts";
import { makeTracker } from "../infra/tracker/index.ts";
import { manifests } from "../application/manifests.ts";
import { projects } from "../application/projects.ts";
import { sessions } from "../application/sessions.ts";
import { setups } from "../application/setups.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { StartResult } from "./results.ts";

export interface StartInput {
  id: TaskId;
  /** With a title, no tracker is needed. */
  title: string | undefined;
  /** Default: the manifest's `base`. */
  base: string | undefined;
  tmux: boolean;
  setup: boolean;
}

/** Worktree + branch from `base`, task dir with `task.md` linked as `.tenbox`, setup, tmux session with `claude`. */
export async function startTask(input: StartInput): Promise<StartResult> {
  const { id } = input;
  const { project, manifest } = await projects.get(env().cwd);
  const projectId = await manifests.ensureId(project.mainDir);
  const base = input.base ?? manifest.base;
  const tracker = makeTracker(manifest.tracker);
  const task = await tasks.get(input, tracker);
  const taskWorktree = taskWorktreeDir(env().wtRoot, project.name, id);
  const branch = taskBranch(manifest.names, id);
  const session = tmuxSessionName(manifest.names, id);
  const { tenboxHome } = env();
  await projects.save(tenboxHome, { id: projectId, name: project.name });
  const dir = taskDir(tenboxHome, projectId, id);
  const created = await worktrees.ensure({ project, taskWorktree, taskDir: dir, branch, base });
  const task_md = await tasks.ensureFiles(taskWorktree, task);
  const setup = await setups.run(taskWorktree, manifest.setup, input.setup);
  const status = await tasks.updateStatus(input, tracker, "in_progress");
  const tmux = await sessions.ensure(session, input.tmux ? taskWorktree : null);
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
    tmux,
  };
}
