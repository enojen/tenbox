import type { TaskId } from "../../domain/ids.ts";
import { reportUsage } from "../../domain/runs.ts";
import { taskDir } from "../../domain/taskDirs.ts";
import { taskWorktreeDir } from "../../domain/worktrees.ts";
import { projects } from "../application/projects.ts";
import { stats } from "../application/stats.ts";
import { env } from "../infra/env.ts";
import type { StatsResult } from "./results.ts";

/** Minutes and tokens per round, calls and tokens per role and per model. */
export async function showStats(id: TaskId): Promise<StatsResult> {
  const { cwd, wtRoot, tenboxHome } = env();
  const { project, manifest } = await projects.get(cwd);
  // Read only: a project with no id has no task dirs, and stats must not write the manifest.
  const dir = manifest.id === undefined ? null : taskDir(tenboxHome, manifest.id, id);
  const taskWorktree = taskWorktreeDir(wtRoot, project.name, id);
  const found = await stats.get({ id, taskDir: dir, taskWorktree });
  return { ok: true, task: id, source: found.from, runs: found.runs, ...reportUsage(found.agents) };
}
