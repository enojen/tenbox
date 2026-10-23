import type { TaskId } from "../../domain/ids.ts";
import type { TaskKind } from "../../domain/kinds.ts";
import { sessionName, taskBranch } from "../../domain/names.ts";
import { taskDir } from "../../domain/taskDirs.ts";
import { TASK_STATUS } from "../../domain/tracker.ts";
import { taskWorktreeDir } from "../../domain/worktrees.ts";
import { manifests } from "../application/manifests.ts";
import { plans } from "../application/plans.ts";
import { projects } from "../application/projects.ts";
import { sessions } from "../application/sessions.ts";
import { setups } from "../application/setups.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { env } from "../infra/env.ts";
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
