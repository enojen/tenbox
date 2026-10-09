import { noSessionError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { approvals } from "../application/approvals.ts";
import { builds } from "../application/builds.ts";
import { projects } from "../application/projects.ts";
import { sessions } from "../application/sessions.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { SendBuildResult, TaskFileResult } from "./results.ts";

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

export interface BuildDoneInput {
  id: TaskId;
  /** The build result as JSON text. */
  json: string;
}

/** Validates the build result and writes it to the task's `.tenbox/build.json`. */
export async function buildDone(input: BuildDoneInput): Promise<TaskFileResult> {
  const taskWorktree = await worktrees.get(input.id);
  const file = await builds.save(taskWorktree, input.json);
  return { ok: true, task: input.id, file };
}
