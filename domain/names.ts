import { isSafeName, type TaskId } from "./ids.ts";
import type { Names } from "./manifests.ts";

/*
 * The names a task gets from the `names:` templates in `tenbox.yaml`: its branch and the
 * name of its background sessions. `taskId()` and `NamesSchema` together keep them safe.
 */

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
