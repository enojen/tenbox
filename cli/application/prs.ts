import type { TaskId } from "../../domain/ids.ts";
import { groupLine } from "../../domain/pr.ts";
import { type GroupPr, gh } from "../infra/gh.ts";

interface PrLookup {
  dir: string;
  id: TaskId;
  group: number;
  branch: string;
}

/** PRs: the GitHub pull request of one group, found by its body line. */
export const prs = { find };

/** By the body line, else by the branch: PRs opened before the line have none. */
async function find(lookup: PrLookup): Promise<GroupPr | null> {
  const { dir, id, group, branch } = lookup;
  const byLine = await gh.findByLine(dir, groupLine(id, group));
  if (byLine !== null) return byLine;
  return gh.findByBranch(dir, branch);
}
