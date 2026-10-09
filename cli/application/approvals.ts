import path from "node:path";
import type { Approval } from "../../domain/approval.ts";
import { TenboxError } from "../../domain/errors.ts";
import { approvedFile, tenboxDir } from "../../domain/task.ts";
import { sha256Hex } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

const JSON_INDENT = 2;

/** Approvals: `approved.json` in the task dir, written by `tenbox approve`. */
export const approvals = { save };

/** Records the approval of the current `plan.md`; `no-plan` when there is none. A second save overwrites. */
async function save(taskWorktree: string): Promise<Approval> {
  const dir = tenboxDir(taskWorktree);
  const plan = await files.read(path.join(dir, "plan.md"));
  if (plan === null) {
    throw new TenboxError(`no plan.md in ${dir}; run /tenbox-plan first`, "no-plan");
  }
  const approval: Approval = { at: new Date().toISOString(), plan_sha: sha256Hex(plan) };
  await files.write(approvedFile(dir), `${JSON.stringify(approval, null, JSON_INDENT)}\n`);
  return approval;
}
