import { type PlanResult, parsePlan, planFile, readPlan } from "../../domain/plan.ts";
import { tenboxDir } from "../../domain/task.ts";
import { files } from "../infra/files.ts";

/** Plans: the validated planner result, `plan.json` in the task dir. */
export const plans = { save, find };

/** The saved plan and the path of `plan.json`. */
interface SavedPlan {
  file: string;
  plan: PlanResult;
}

/** Writes `plan.json`; `bad-plan` when the text is not a valid plan result. */
async function save(taskWorktree: string, planText: string): Promise<SavedPlan> {
  const plan = parsePlan(planText);
  const file = planFile(tenboxDir(taskWorktree));
  await files.writeJson(file, plan);
  return { file, plan };
}

/** The plan result in `dir`; null when `plan.json` is missing or not valid. */
async function find(dir: string): Promise<PlanResult | null> {
  const text = await files.read(planFile(dir));
  return text === null ? null : readPlan(text);
}
