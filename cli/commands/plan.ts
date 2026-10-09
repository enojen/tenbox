import type { TaskId } from "../../domain/ids.ts";
import { plans } from "../application/plans.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { PlanDoneResult } from "./results.ts";

export interface PlanDoneInput {
  id: TaskId;
  /** The planner result as JSON text. */
  json: string;
}

/** Validates the planner result and writes it to the task's `.tenbox/plan.json`. */
export async function planDone(input: PlanDoneInput): Promise<PlanDoneResult> {
  const taskWorktree = await worktrees.get(input.id);
  const file = await plans.save(taskWorktree, input.json);
  return { ok: true, task: input.id, file };
}
