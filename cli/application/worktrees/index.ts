import { ensure } from "./ensure.ts";
import { get } from "./get.ts";

export type { WorktreeInput } from "./ensure.ts";

/** Task worktrees: `~/wt/<project>/<id>`, one per task. */
export const worktrees = { ensure, get };
