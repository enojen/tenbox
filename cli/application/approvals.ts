import { type Approval, readApproval } from "../../domain/approval.ts";
import { noPlanError, notApprovedError, planChangedError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { approvedFile, planMdFile, tenboxDir } from "../../domain/task.ts";
import { sha256Hex } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

const JSON_INDENT = 2;

/** Approvals: `approved.json` in the task dir, written by `tenbox approve`. */
export const approvals = { save, get };

/** Records the approval of the current `plan.md`; `no-plan` when there is none. A second save overwrites. */
async function save(taskWorktree: string): Promise<Approval> {
  const dir = tenboxDir(taskWorktree);
  const plan = await files.read(planMdFile(dir));
  if (plan === null) {
    throw noPlanError(dir);
  }
  const approval: Approval = { at: new Date().toISOString(), plan_sha: sha256Hex(plan) };
  await files.write(approvedFile(dir), `${JSON.stringify(approval, null, JSON_INDENT)}\n`);
  return approval;
}

/** The approval of the current `plan.md`; `not-approved` when there is none, `plan-changed` when `plan.md` differs. */
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

/** True when `plan.md` is gone or its SHA-256 is not the approved one. */
async function planChanged(dir: string, approval: Approval): Promise<boolean> {
  const plan = await files.read(planMdFile(dir));
  return plan === null || sha256Hex(plan) !== approval.plan_sha;
}
