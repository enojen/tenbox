/** What `tenbox approve` records in `approved.json`: when, and which `plan.md`. */
export interface Approval {
  /** ISO time of the approval. */
  at: string;
  /** SHA-256 hex of the approved `plan.md`. */
  plan_sha: string;
}
