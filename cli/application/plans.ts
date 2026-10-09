import { type PlanResult, parsePlan, planFile, readPlan } from "../../domain/plan.ts";
import { tenboxDir } from "../../domain/task.ts";
import { files } from "../infra/files.ts";

const JSON_INDENT = 2;

/** Plans: the validated planner result, `plan.json` in the task dir. */
export const plans = { save, find };

/** Writes `plan.json` and returns its path; `bad-plan` when the text is not a valid plan result. */
async function save(taskWorktree: string, planText: string): Promise<string> {
  const plan = parsePlan(planText);
  const file = planFile(tenboxDir(taskWorktree));
  await files.write(file, `${JSON.stringify(plan, null, JSON_INDENT)}\n`);
  return file;
}

/** The plan result in `dir`; null when `plan.json` is missing or not valid. */
async function find(dir: string): Promise<PlanResult | null> {
  const text = await files.read(planFile(dir));
  return text === null ? null : readPlan(text);
}
