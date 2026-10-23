import path from "node:path";
import { noPlanResultError } from "../../domain/errors/plans.ts";
import {
  checkPlanMd,
  DOCS_PART_FILE,
  docsPlanOf,
  type PlanResult,
  parsePlan,
  readPlan,
  renderDocsPart,
  renderDocsPlanMd,
} from "../../domain/plans.ts";
import { partsDir, planFile, planMdFile, tenboxDir } from "../../domain/taskDirs.ts";
import type { Task } from "../../domain/tasks.ts";
import { files } from "../infra/files.ts";
import { tasks } from "./tasks.ts";

/** Plans: the validated planner result, `plan.json` in the task dir. */
export const plans = { save, update, find, get, ensureDocs };

/** The saved plan and the path of `plan.json`. */
interface SavedPlan {
  file: string;
  plan: PlanResult;
}

/**
 * Writes `plan.json`; `bad-input` when the text is not a valid plan result, `bad-file` when
 * `plan.md` is over the limit, `no-plan` when it is missing. A kind set by `tenbox start --kind` wins.
 */
async function save(taskWorktree: string, planText: string): Promise<SavedPlan> {
  const dir = tenboxDir(taskWorktree);
  const parsed = parsePlan(planText);
  const planMd = await files.read(planMdFile(dir));
  checkPlanMd({ dir, planMd });
  const task = await tasks.find(dir);
  const plan = task?.kind ? { ...parsed, kind: task.kind } : parsed;
  const file = planFile(dir);
  await files.writeJson(file, plan);
  return { file, plan };
}

/** Rewrites `plan.json` in `dir` with a plan that changed, such as a decision `tenbox decide` took. */
async function update(dir: string, plan: PlanResult): Promise<void> {
  await files.writeJson(planFile(dir), plan);
}

/** Writes the `docs` plan: `plan.md`, `plan.json` and the one part file. */
async function ensureDocs(taskWorktree: string, task: Task): Promise<void> {
  const dir = tenboxDir(taskWorktree);
  await files.write(planMdFile(dir), renderDocsPlanMd(task));
  await files.writeJson(planFile(dir), docsPlanOf(task));
  await files.write(path.join(partsDir(dir), DOCS_PART_FILE), renderDocsPart());
}

/** The plan result in `dir`; null when `plan.json` is missing, `bad-file` when it is not valid. */
async function find(dir: string): Promise<PlanResult | null> {
  const file = planFile(dir);
  const text = await files.read(file);
  return text === null ? null : readPlan(text, file);
}

/** The plan result in `dir`; `no-plan` when `plan.json` is missing, `bad-file` when it is not valid. */
async function get(dir: string): Promise<PlanResult> {
  const plan = await find(dir);
  if (plan === null) throw noPlanResultError(dir);
  return plan;
}
