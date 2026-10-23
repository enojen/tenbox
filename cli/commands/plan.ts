import type { TaskId } from "../../domain/ids.ts";
import { NOTIFICATION_STATE } from "../../domain/notifications.ts";
import { planLines } from "../../domain/plans.ts";
import { planFile, tenboxDir } from "../../domain/taskDirs.ts";
import { TASK_STATE } from "../../domain/tasks.ts";
import { notifications } from "../application/notifications.ts";
import { plans } from "../application/plans.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { log } from "../infra/env.ts";
import type { PlanShowResult, TaskFileResult } from "./results.ts";

export interface PlanDoneInput {
  id: TaskId;
  /** The planner result as JSON text. */
  json: string;
}

/** Validates the planner result and writes it to the task's `.tenbox/plan.json`. */
export async function planDone(input: PlanDoneInput): Promise<TaskFileResult> {
  const taskWorktree = await worktrees.get(input.id);
  const { file, plan } = await plans.save(taskWorktree, input.json);
  await tasks.saveStatus(tenboxDir(taskWorktree), TASK_STATE.planReady);
  const { parts, questions } = plan;
  const blocking = questions.filter((question) => question.blocking).length;
  const detail = `parts ${parts.length}, open questions ${questions.length} (${blocking} blocking)`;
  const notification = { id: input.id, state: NOTIFICATION_STATE.planReady, detail };
  await notifications.send({ taskWorktree, notification });
  return { ok: true, task: input.id, file };
}

/** Prints the plan of `plan.json`: as JSON on stdout, as lines on stderr. */
export async function planShow(id: TaskId): Promise<PlanShowResult> {
  const taskWorktree = await worktrees.get(id);
  const dir = tenboxDir(taskWorktree);
  const plan = await plans.get(dir);
  log(planLines(plan).join("\n"));
  const { parts, examples, decisions, questions } = plan;
  return { ok: true, task: id, file: planFile(dir), parts, examples, decisions, questions };
}
