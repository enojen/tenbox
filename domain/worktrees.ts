import path from "node:path";
import { isSafeName, type TaskId } from "./ids.ts";
import type { Names } from "./manifests.ts";

/* The checkouts under the worktree root: `~/wt/<project>/main` and one task worktree per task. */

/** The main checkout sits at `~/wt/<project>/main`, next to the task worktrees. */
export const MAIN_CHECKOUT_DIR = "main";

const GROUP_SUFFIX = /-\d+$/;

/** `~/wt/<project>/<id>`, next to `~/wt/<project>/main`. */
export function taskWorktreeDir(wtRoot: string, projectName: string, id: TaskId): string {
  return path.join(wtRoot, projectName, id);
}

/**
 * The task worktree names among the directories of `~/wt/<project>`: not `main`, and not a
 * group worktree `<id>-N` that sits next to the worktree `<id>`.
 */
export function taskWorktreeNames(names: string[]): string[] {
  return names.filter((name) => {
    if (name === MAIN_CHECKOUT_DIR) return false;
    return !names.includes(name.replace(GROUP_SUFFIX, "")) || !GROUP_SUFFIX.test(name);
  });
}

/** Tenbox and Claude Code write these into worktrees; keep them out of `git status`. */
export const EXCLUDED_PATHS: readonly string[] = [
  ".tenbox", // the link to the task dir; no slash, a slash would skip a symlink
  ".claude/worktrees/", // Claude Code's own worktrees
  ".claude/settings.local.json", // written by `tenbox start`
];

export function taskBranch(names: Names, id: TaskId): string {
  return fillName(names.branch, id);
}

/** True when `branch` is what `names.branch` makes of some task id. */
export function isTaskBranch(names: Names, branch: string): boolean {
  const [prefix = "", suffix = ""] = names.branch.split("{id}");
  if (!branch.startsWith(prefix) || !branch.endsWith(suffix)) return false;
  return isSafeName(branch.slice(prefix.length, branch.length - suffix.length));
}

/** The `claude -n` name of the task's background sessions. */
export function sessionName(names: Names, id: TaskId): string {
  return fillName(names.session, id);
}

function fillName(template: string, id: TaskId): string {
  return template.replace("{id}", id);
}
