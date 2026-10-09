import { buildFile } from "../../domain/build.ts";
import { waitTimeoutError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { planFile } from "../../domain/plan.ts";
import { tenboxDir } from "../../domain/task.ts";
import { MS_PER_SECOND } from "../../domain/utils.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { files } from "../infra/files.ts";
import type { TaskFileResult } from "./results.ts";

export type WaitKind = "plan" | "build";

export interface WaitInput {
  id: TaskId;
  kind: WaitKind;
  timeoutSeconds: number;
}

/** True for the two files `tenbox wait` can wait for. */
export const isWaitKind = (value: string | undefined): value is WaitKind =>
  value === "plan" || value === "build";

const FILE_OF: Record<WaitKind, (dir: string) => string> = {
  plan: planFile,
  build: buildFile,
};

/** Returns when `plan.json` or `build.json` of the task exists; checks once a second. */
export async function waitForFile(input: WaitInput): Promise<TaskFileResult> {
  const { id, kind, timeoutSeconds } = input;
  const taskWorktree = await worktrees.get(id);
  const file = FILE_OF[kind](tenboxDir(taskWorktree));
  const deadline = Date.now() + timeoutSeconds * MS_PER_SECOND;
  let found = await files.exists(file);
  while (!found) {
    if (Date.now() >= deadline) throw waitTimeoutError(file, timeoutSeconds);
    await Bun.sleep(MS_PER_SECOND);
    found = await files.exists(file);
  }
  return { ok: true, task: id, file };
}
