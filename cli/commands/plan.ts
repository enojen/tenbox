import type { TaskId } from "../../domain/ids.ts";
import { NOTIFICATION_STATE } from "../../domain/notifications.ts";
import { planLines } from "../../domain/plans.ts";
import { planFile, tenboxDir } from "../../domain/taskDirs.ts";
import { TASK_STATE } from "../../domain/tasks.ts";
import { decisions } from "../application/decisions.ts";
import { notifications } from "../application/notifications.ts";
import { parts } from "../application/parts.ts";
import { plans } from "../application/plans.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { log } from "../infra/env.ts";
import type { PlanDoneResult, PlanShowResult } from "./results.ts";

export interface PlanDoneInput {
  id: TaskId;
  /** The planner result as JSON text. */
  json: string;
}

/** Validates the planner result, writes it to `.tenbox/plan.json` and names the stale part files. */
export async function planDone(input: PlanDoneInput): Promise<PlanDoneResult> {
  const taskWorktree = await worktrees.get(input.id);
  const dir = tenboxDir(taskWorktree);
  const { file, plan } = await plans.save(taskWorktree, input.json);
  await tasks.saveStatus(dir, TASK_STATE.planReady);
  const stale = await parts.findStale(dir, plan.parts);
  for (const part of stale) log(`stale part ${part.part}: ${part.file ?? "-"}, ${part.reason}`);
  const { questions } = plan;
  const blocking = questions.filter((question) => question.blocking).length;
  const detail = `parts ${plan.parts.length}, open questions ${questions.length} (${blocking} blocking)`;
  const notification = { id: input.id, state: NOTIFICATION_STATE.planReady, detail };
  await notifications.send({ taskWorktree, notification });
  return { ok: true, task: input.id, file, stale_parts: stale };
}

/** Prints the plan of `plan.json` with the questions of `questions.md`: as JSON on stdout, as lines on stderr. */
export async function planShow(id: TaskId): Promise<PlanShowResult> {
  const taskWorktree = await worktrees.get(id);
  const dir = tenboxDir(taskWorktree);
  const plan = await plans.get(dir);
  const questions = await decisions.listQuestions(dir);
  log(planLines(plan, questions).join("\n"));
  const { estimated_lines, parts, groups, examples } = plan;
  const file = planFile(dir);
  const shown = { estimated_lines, parts, groups: groups ?? null, examples, questions };
  return { ok: true, task: id, file, ...shown, decisions: plan.decisions };
}
