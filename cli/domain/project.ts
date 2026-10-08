import path from "node:path";
import type { TaskId } from "./ids.ts";

export interface Project {
  /** `tenbox.yaml` `project:`, else the checkout's directory name, or its parent's when the checkout is `main`. */
  name: string;
  /** The main checkout, the directory that holds `.git`. */
  mainDir: string;
  /** The shared `.git` directory, the same from every linked worktree. */
  commonDir: string;
}

/** The main checkout sits at `~/wt/<project>/main`, next to the task worktrees. */
const MAIN_CHECKOUT_DIR = "main";

export function projectName(mainDir: string, manifestProject: string | undefined): string {
  if (manifestProject) return manifestProject;
  const base = path.basename(mainDir);
  return base === MAIN_CHECKOUT_DIR ? path.basename(path.dirname(mainDir)) : base;
}

/** `~/wt/<project>/<id>`, next to `~/wt/<project>/main`. */
export function taskWorktreeDir(wtRoot: string, projectName: string, id: TaskId): string {
  return path.join(wtRoot, projectName, id);
}

/** `~/wt/.archive/<project>/<id>`: where a closed task's `.tenbox/` goes. */
export function archiveDir(wtRoot: string, projectName: string, id: TaskId): string {
  return path.join(wtRoot, ".archive", projectName, id);
}

/** Tenbox and Claude Code write these into worktrees; keep them out of `git status`. */
export const EXCLUDED_PATHS: readonly string[] = [
  ".tenbox/", // task state written by tenbox
  ".claude/worktrees/", // Claude Code's own worktrees
  ".claude/settings.local.json", // written by `tenbox start`
];
