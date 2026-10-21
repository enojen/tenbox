import { type Approval, readApproval } from "../../domain/approval.ts";
import {
  noPlanResultError,
  notApprovedError,
  planChangedError,
} from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { planFile, validatePlan } from "../../domain/plan.ts";
import { approvedFile, planMdFile, tenboxDir } from "../../domain/task.ts";
import { sha256Hex } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

/** Approvals: `approved.json` in the task dir, written by `tenbox approve`. */
export const approvals = { save, update, get };

/**
 * Records the approval of the current `plan.json`, checked as `tenbox plan done` checks it:
 * `no-plan` without `plan.json` or `plan.md`, `bad-plan` when it is not valid. A second save overwrites.
 */
async function save(taskWorktree: string): Promise<Approval> {
  const dir = tenboxDir(taskWorktree);
  const plan = await files.read(planFile(dir));
  if (plan === null) throw noPlanResultError(dir);
  const planMd = await files.read(planMdFile(dir));
  validatePlan({ dir, plan, planMd });
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
  const approval: Approval = { at: new Date().toISOString(), plan_sha: sha256Hex(plan) };
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

/** The approval in `dir`; null when `approved.json` is missing or not valid. */
async function find(dir: string): Promise<Approval | null> {
  const text = await files.read(approvedFile(dir));
  return text === null ? null : readApproval(text);
}

/** True when `plan.json` is gone or its SHA-256 is not the approved one. */
async function planChanged(dir: string, approval: Approval): Promise<boolean> {
  const plan = await files.read(planFile(dir));
  return plan === null || sha256Hex(plan) !== approval.plan_sha;
}
