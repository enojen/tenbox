import { z } from "zod";
import { badFileError } from "./errors/tasks.ts";
import { jsons } from "./utils.ts";

/** What `tenbox approve` records in `approved.json`: when, and which `plan.json`. */
const ApprovalSchema = z.object({
  /** ISO time of the approval. */
  at: z.iso.datetime(),
  /** SHA-256 hex of the approved `plan.json` text. */
  plan_sha: z.string(),
});

export type Approval = z.infer<typeof ApprovalSchema>;

/** The approval in the text of `approved.json`; `bad-file` when it is not JSON or does not match. */
export function readApproval(text: string, file: string): Approval {
  const result = jsons.check(ApprovalSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}
