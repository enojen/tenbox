import { z } from "zod";
import { badFileError } from "./errors/index.ts";
import { LensSchema } from "./kinds.ts";
import { jsons } from "./utils.ts";

/* A group: one or more parts of a task that become one PR. */

const text = z.string().min(1);

/** How a group is built: the worker model and effort, the review lenses, the check tier. */
const RecipeSchema = z.object({
  model: z.enum(["haiku", "sonnet", "opus", "fable"]),
  effort: z.enum(["low", "medium", "high"]),
  lenses: z.array(LensSchema),
  tier: z.enum(["fast", "full"]),
});

/** One PR of the task: `needs` holds smaller group ids; an empty list branches off the base. */
export const GroupSchema = z.object({
  id: z.number().int(),
  name: text,
  parts: z.array(text),
  needs: z.array(z.number().int()),
  recipe: RecipeSchema,
});

export type Group = z.infer<typeof GroupSchema>;

const GroupStartSchema = z.object({ start: z.string() });

/** Where a group branch left its needs; `tenbox pr` replays only the commits after `start`. */
export type GroupStart = z.infer<typeof GroupStartSchema>;

/** The start in the text of `group.json`; `bad-file` when it is not JSON or does not match. */
export function readGroupStart(text: string, file: string): GroupStart {
  const result = jsons.check(GroupStartSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}

/** The worktree of a group above 1: `~/wt/<project>/<id>-<N>`, next to the task worktree. */
export const groupWorktreeDir = (taskWorktree: string, group: number): string =>
  `${taskWorktree}-${group}`;

/** The branch of a group above 1: `<task branch>-<N>`. */
export const groupBranch = (taskBranchName: string, group: number): string =>
  `${taskBranchName}-${group}`;

/** One part as one group holds it. */
interface GroupedPart {
  group: number;
  part: string;
}

/** Ids run 1..n in list order. */
function idIssues(groups: Group[]): string[] {
  return groups
    .filter((group, index) => group.id !== index + 1)
    .map(
      (group) =>
        `group ${group.id}: ids must be 1..n in order, expected ${groups.indexOf(group) + 1}`,
    );
}

/** A group needs only smaller groups, so there is no cycle. */
function needIssues(groups: Group[]): string[] {
  return groups.flatMap((group) =>
    group.needs
      .filter((need) => need >= group.id)
      .map((need) => `group ${group.id}: needs ${need}, which is not a smaller group`),
  );
}

/** Every part of the plan is in exactly one group, and a group names only parts of the plan. */
function partIssues(groups: Group[], partIds: string[]): string[] {
  const grouped: GroupedPart[] = groups.flatMap((group) =>
    group.parts.map((part) => ({ group: group.id, part })),
  );
  const timesGrouped = (id: string) => grouped.filter((entry) => entry.part === id).length;
  const unknown = grouped
    .filter((entry) => !partIds.includes(entry.part))
    .map((entry) => `group ${entry.group}: unknown part ${entry.part}`);
  const twice = partIds
    .filter((id) => timesGrouped(id) > 1)
    .map((id) => `part ${id} is in two groups`);
  const missing = partIds
    .filter((id) => timesGrouped(id) === 0)
    .map((id) => `part ${id} is in no group`);
  return [...unknown, ...twice, ...missing];
}

/** What is wrong with the groups of a plan with these part ids; empty when nothing is. */
export function groupIssues(groups: Group[], partIds: string[]): string[] {
  return [...idIssues(groups), ...needIssues(groups), ...partIssues(groups, partIds)];
}
