import path from "node:path";
import { noBaseError, TenboxError } from "../../../domain/errors.ts";
import { EXCLUDED_PATHS, type Project } from "../../../domain/project.ts";
import { claudeSettings } from "../../infra/claudeSettings.ts";
import { log } from "../../infra/env.ts";
import { files } from "../../infra/files.ts";
import { git } from "../../infra/git.ts";

export interface WorktreeInput {
  project: Project;
  taskWorktree: string;
  branch: string;
  base: string;
}

/**
 * Adds the task worktree on its branch, or reuses it, and prepares the main checkout for it.
 * Returns true when the worktree was created.
 */
export async function ensure(input: WorktreeInput): Promise<boolean> {
  const { project } = input;
  const created = await addOrReuse(input);
  await git.ensureExcludes(project.commonDir, EXCLUDED_PATHS);
  await claudeSettings.ensureHeadBaseRef(project.mainDir);
  return created;
}

async function addOrReuse(input: WorktreeInput): Promise<boolean> {
  const { project, taskWorktree, branch, base } = input;
  const exists = await files.isDir(taskWorktree);
  if (exists) {
    await assertWorktree(taskWorktree);
    log(`tenbox start: worktree ${taskWorktree} exists, reusing it`);
    return false;
  }
  const baseExists = await git.refExists(project.mainDir, `${base}^{commit}`);
  if (!baseExists) throw noBaseError(base, "not found");
  await files.mkdir(path.dirname(taskWorktree));
  await git.addWorktree({ mainDir: project.mainDir, path: taskWorktree, branch, base });
  log(`tenbox start: worktree ${taskWorktree} on ${branch} from ${base}`);
  return true;
}

async function assertWorktree(taskWorktree: string): Promise<void> {
  const top = await git.findTopLevel(taskWorktree);
  if (top === taskWorktree) return;
  throw new TenboxError(`${taskWorktree} exists but is not a git worktree`, "worktree");
}
