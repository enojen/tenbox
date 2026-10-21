import { z } from "zod";
import { parseObject } from "./utils.ts";

/** What `tenbox approve` records in `approved.json`: when, and which `plan.json`. */
const ApprovalSchema = z.object({
  /** ISO time of the approval. */
  at: z.iso.datetime(),
  /** SHA-256 hex of the approved `plan.json` text. */
  plan_sha: z.string(),
});

export type Approval = z.infer<typeof ApprovalSchema>;

/** The approval in `approved.json` text; null when it is not a JSON object or does not match. */
export function readApproval(text: string): Approval | null {
  const parsed = ApprovalSchema.safeParse(parseObject(text));
  return parsed.success ? parsed.data : null;
}
