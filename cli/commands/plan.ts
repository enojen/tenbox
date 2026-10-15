import type { TaskId } from "../../domain/ids.ts";
import { NOTIFICATION_STATE } from "../../domain/notifications.ts";
import { notifications } from "../application/notifications.ts";
import { plans } from "../application/plans.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { TaskFileResult } from "./results.ts";

export interface PlanDoneInput {
  id: TaskId;
  /** The planner result as JSON text. */
  json: string;
}

/** Validates the planner result and writes it to the task's `.tenbox/plan.json`. */
export async function planDone(input: PlanDoneInput): Promise<TaskFileResult> {
  const taskWorktree = await worktrees.get(input.id);
  const { file, plan } = await plans.save(taskWorktree, input.json);
  const { parts, questions } = plan;
  const blocking = questions.filter((question) => question.blocking).length;
  const detail = `parts ${parts.length}, open questions ${questions.length} (${blocking} blocking)`;
  const notification = { id: input.id, state: NOTIFICATION_STATE.planReady, detail };
  await notifications.send({ taskWorktree, notification });
  return { ok: true, task: input.id, file };
}
