import { noSessionError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { approvals } from "../application/approvals.ts";
import { projects } from "../application/projects.ts";
import { sessions } from "../application/sessions.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { SendBuildResult } from "./results.ts";

/** Checks the approval, then types `/tenbox-build <id>` into the task's `claude` session. */
export async function sendBuild(id: TaskId): Promise<SendBuildResult> {
  const taskWorktree = await worktrees.get(id);
  await approvals.get(taskWorktree, id);
  const { manifest } = await projects.get(taskWorktree);
  // A project with no id was never started with a task tmux server.
  if (manifest.id === undefined) throw noSessionError(id);
  const target = sessions.tmuxTarget(manifest.names, manifest.id, id);
  const sent = `/tenbox-build ${id}`;
  await sessions.send(id, target, sent);
  return { ok: true, task: id, ...target, sent };
}
