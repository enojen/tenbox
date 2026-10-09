import path from "node:path";
import type { TaskId } from "../../domain/ids.ts";
import { type Task, renderTaskMd, tenboxDir } from "../../domain/task.ts";
import type { TaskStatus, Tracker } from "../../domain/tracker.ts";
import { errorMessage } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

interface TaskSource {
  id: TaskId;
  /** With a title, no tracker is needed. */
  title?: string;
}

/** Tasks: one tracker item each, with its files in the task dir, reached as `.tenbox` in the task worktree. */
export const tasks = { get, ensureFiles, updateStatus };

/** From the title when one is given, else from the tracker. */
async function get(source: TaskSource, tracker: Tracker): Promise<Task> {
  const { id, title } = source;
  if (title) return { id, title, description: "", url: "", status: "todo", tracker: "none" };
  const found = await tracker.getTask(id);
  return { ...found, id, tracker: tracker.kind };
}

/** Makes the task files through `.tenbox` and returns the path of `task.md`; an existing one is kept. */
async function ensureFiles(taskWorktree: string, task: Task): Promise<string> {
  const dir = tenboxDir(taskWorktree);
  for (const sub of ["parts", "rounds"]) {
    await files.mkdir(path.join(dir, sub));
  }
  const taskMd = path.join(dir, "task.md");
  const kept = await files.exists(taskMd);
  if (!kept) await files.write(taskMd, renderTaskMd(task));
  return taskMd;
}

/** Only tasks that came from the tracker change its status; a failure is reported, not thrown. */
async function updateStatus(
  source: TaskSource,
  tracker: Tracker,
  status: TaskStatus,
): Promise<string> {
  if (source.title || tracker.kind === "none") return "skipped";
  try {
    await tracker.updateStatus(source.id, status);
    return status;
  } catch (e) {
    return `failed: ${errorMessage(e)}`;
  }
}
