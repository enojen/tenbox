import path from "node:path";
import type { ProjectId, TaskId } from "./ids.ts";

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

const GROUP_SUFFIX = /-\d+$/;

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

/** `~/wt/<project>/<id>`, next to `~/wt/<project>/main`. */
export function taskWorktreeDir(wtRoot: string, projectName: string, id: TaskId): string {
  return path.join(wtRoot, projectName, id);
}

/** `~/.tenbox/<project id>`: holds `project.json` and the task dirs. */
export function projectDir(tenboxHome: string, id: ProjectId): string {
  return path.join(tenboxHome, id);
}

/** `~/.tenbox/<project id>/<id>`: the files of one task; `.tenbox` in its worktree links here. */
export function taskDir(tenboxHome: string, projectId: ProjectId, id: TaskId): string {
  return path.join(projectDir(tenboxHome, projectId), id);
}

/** Tenbox and Claude Code write these into worktrees; keep them out of `git status`. */
export const EXCLUDED_PATHS: readonly string[] = [
  ".tenbox", // the link to the task dir; no slash, a slash would skip a symlink
  ".claude/worktrees/", // Claude Code's own worktrees
  ".claude/settings.local.json", // written by `tenbox start`
];
