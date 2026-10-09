import type { TaskId } from "../../domain/ids.ts";
import {
  partsDir,
  readTaskFile,
  renderTaskMd,
  roundsDir,
  type Task,
  type TaskFile,
  taskFile,
  taskFileOf,
  taskMdFile,
  tenboxDir,
} from "../../domain/task.ts";
import type { TaskStatus, Tracker } from "../../domain/tracker.ts";
import { errorMessage } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

interface TaskSource {
  id: TaskId;
  /** With a title, no tracker is needed. */
  title: string | undefined;
}

/** Tasks: one tracker item each, with its files in the task dir, reached as `.tenbox` in the task worktree. */
export const tasks = { get, find, ensureFiles, updateStatus };

/** From the title when one is given, else from the tracker. */
async function get(source: TaskSource, tracker: Tracker): Promise<Task> {
  const { id, title } = source;
  if (title) return { id, title, description: "", url: "", status: "todo", tracker: "none" };
  const found = await tracker.getTask(id);
  return { ...found, id, tracker: tracker.kind };
}

/** The task in `task.json` of `dir`; null when it is missing or not valid. */
async function find(dir: string): Promise<TaskFile | null> {
  const text = await files.read(taskFile(dir));
  return text === null ? null : readTaskFile(text);
}

/** Makes the task files through `.tenbox` and returns the path of `task.md`; existing ones are kept. */
async function ensureFiles(taskWorktree: string, task: Task): Promise<string> {
  const dir = tenboxDir(taskWorktree);
  await files.mkdir(partsDir(dir));
  await files.mkdir(roundsDir(dir));
  const taskMd = taskMdFile(dir);
  const kept = await files.exists(taskMd);
  if (!kept) await files.write(taskMd, renderTaskMd(task));
  const taskJson = taskFile(dir);
  const jsonKept = await files.exists(taskJson);
  if (!jsonKept) await files.write(taskJson, `${JSON.stringify(taskFileOf(task), null, 2)}\n`);
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
