import type { TaskId } from "../../domain/ids.ts";
import { TRACKER_KIND } from "../../domain/manifest.ts";
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
import { failedState } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

interface TaskSource {
  id: TaskId;
  /** With a title, no tracker is needed. */
  title: string | undefined;
}

/** The status of a task that has a title and no tracker. */
const UNTRACKED_STATUS = "todo";

/** The tracker step when Tenbox does not change the status. */
const STATUS_SKIPPED = "skipped";

/** The real status name the tracker set, `skipped` or `failed: <reason>`. */
export type StatusUpdate = string;

/** Tasks: one tracker item each, with its files in the task dir, reached as `.tenbox` in the task worktree. */
export const tasks = { get, find, ensureFiles, updateStatus };

/** From the title when one is given, else from the tracker. */
async function get(source: TaskSource, tracker: Tracker): Promise<Task> {
  const { id, title } = source;
  if (title)
    return {
      id,
      title,
      description: "",
      url: "",
      status: UNTRACKED_STATUS,
      tracker: TRACKER_KIND.none,
    };
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
  if (!jsonKept) await files.writeJson(taskJson, taskFileOf(task));
  return taskMd;
}

/** Only tasks that came from the tracker change its status; a failure is reported, not thrown. */
async function updateStatus(
  source: TaskSource,
  tracker: Tracker,
  status: TaskStatus,
): Promise<StatusUpdate> {
  if (source.title || tracker.kind === TRACKER_KIND.none) return STATUS_SKIPPED;
  try {
    return await tracker.updateStatus(source.id, status);
  } catch (e) {
    return failedState(e);
  }
}
