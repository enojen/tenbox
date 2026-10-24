import { type Approval, readApproval } from "../../domain/approvals.ts";
import {
  noPlanResultError,
  notApprovedError,
  planChangedError,
} from "../../domain/errors/plans.ts";
import type { TaskId } from "../../domain/ids.ts";
import { checkPlanMd, readPlan } from "../../domain/plans.ts";
import { approvedFile, planFile, planMdFile, tenboxDir } from "../../domain/taskDirs.ts";
import { hashes } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

/** Approvals: `approved.json` in the task dir, written by `tenbox approve`. */
export const approvals = { save, update, get, findCurrent };

/**
 * Records the approval of the current `plan.json`, checked as `tenbox plan done` checks it:
 * `no-plan` without `plan.json` or `plan.md`, `bad-file` when one is not valid. A second save overwrites.
 */
async function save(taskWorktree: string): Promise<Approval> {
  const dir = tenboxDir(taskWorktree);
  const file = planFile(dir);
  const plan = await files.read(file);
  if (plan === null) throw noPlanResultError(dir);
  readPlan(plan, file);
  const planMd = await files.read(planMdFile(dir));
  checkPlanMd({ dir, planMd });
  return write(dir, plan);
}

/** Approves the `plan.json` of `dir` again when it was approved; null when it was not. */
async function update(dir: string): Promise<Approval | null> {
  const approval = await find(dir);
  const plan = await files.read(planFile(dir));
  if (approval === null || plan === null) return null;
  return write(dir, plan);
}

async function write(dir: string, plan: string): Promise<Approval> {
  const approval: Approval = { at: new Date().toISOString(), plan_sha: hashes.sha256Hex(plan) };
  await files.writeJson(approvedFile(dir), approval);
  return approval;
}

/** The approval of the current `plan.json`; `not-approved` when there is none, `plan-changed` when `plan.json` differs. */
async function get(taskWorktree: string, id: TaskId): Promise<Approval> {
  const dir = tenboxDir(taskWorktree);
  const approval = await find(dir);
  if (approval === null) {
    throw notApprovedError(id);
  }
  const changed = await planChanged(dir, approval);
  if (changed) {
    throw planChangedError(id);
  }
  return approval;
}

/** The approval of the current `plan.json`; null when there is none or `plan.json` changed since. */
async function findCurrent(dir: string): Promise<Approval | null> {
  const approval = await find(dir);
  if (approval === null) return null;
  const changed = await planChanged(dir, approval);
  return changed ? null : approval;
}

/** The approval in `dir`; null when `approved.json` is missing, `bad-file` when it is not valid. */
async function find(dir: string): Promise<Approval | null> {
  const file = approvedFile(dir);
  const text = await files.read(file);
  return text === null ? null : readApproval(text, file);
}

/** True when `plan.json` is gone or its SHA-256 is not the approved one. */
async function planChanged(dir: string, approval: Approval): Promise<boolean> {
  const plan = await files.read(planFile(dir));
  return plan === null || hashes.sha256Hex(plan) !== approval.plan_sha;
}
