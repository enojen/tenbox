import { failedState } from "../../domain/errors/index.ts";
import type { TaskId } from "../../domain/ids.ts";
import type { TaskKind } from "../../domain/kinds.ts";
import { TRACKER_KIND, type TrackerConfig } from "../../domain/manifests.ts";
import { partsDir, roundsDir, taskFile, taskMdFile, tenboxDir } from "../../domain/taskDirs.ts";
import {
  readTaskFile,
  renderTaskMd,
  type Task,
  type TaskFile,
  taskFileOf,
} from "../../domain/tasks.ts";
import {
  type NewTask,
  STATUS_SKIPPED,
  type TaskRef,
  type TaskStatus,
  type Tracker,
} from "../../domain/tracker.ts";
import { files } from "../infra/files.ts";
import { makeTracker } from "../infra/tracker/index.ts";

interface TaskSource {
  id: TaskId;
  /** With a title, no tracker is needed. */
  title: string | undefined;
}

/** The status of a task that has a title and no tracker. */
const UNTRACKED_STATUS = "todo";

/** The real status name the tracker set, `skipped` or `failed: <reason>`. */
export type StatusUpdate = string;

/** The task `ensure` found or wrote; `created` tells which. */
interface EnsuredTask extends TaskRef {
  created: boolean;
}

/** Tasks: one tracker item each, with its files in the task dir, reached as `.tenbox` in the task worktree. */
export const tasks = { get, find, ensure, ensureFiles, updateStatus, updateStatusOf, saveStatus };

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
      comments: [],
    };
  const found = await tracker.getTask(id);
  const comments = await tracker.comments(id);
  return { ...found, id, tracker: tracker.kind, comments };
}

/** The open task with the title, else a new one in the tracker: a title is written once. */
async function ensure(tracker: Tracker, task: NewTask): Promise<EnsuredTask> {
  const found = await tracker.findOpen(task.title);
  if (found !== null) return { ...found, created: false };
  const made = await tracker.create(task);
  return { ...made, created: true };
}

/** The task in `task.json` of `dir`; null when it is missing, `bad-file` when it is not valid. */
async function find(dir: string): Promise<TaskFile | null> {
  const file = taskFile(dir);
  const text = await files.read(file);
  return text === null ? null : readTaskFile(text, file);
}

/** Makes the task files through `.tenbox` and returns the path of `task.md`; existing ones are kept. */
async function ensureFiles(
  taskWorktree: string,
  task: Task,
  kind: TaskKind | undefined,
): Promise<string> {
  const dir = tenboxDir(taskWorktree);
  await files.mkdir(partsDir(dir));
  await files.mkdir(roundsDir(dir));
  const taskMd = taskMdFile(dir);
  const kept = await files.exists(taskMd);
  if (!kept) await files.write(taskMd, renderTaskMd(task));
  const taskJson = taskFile(dir);
  const jsonKept = await files.exists(taskJson);
  if (!jsonKept) await files.writeJson(taskJson, taskFileOf(task, kind));
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

/** The task of `task.json` in a task dir, and the tracker its status goes to. */
interface TaskDirStatus {
  id: TaskId;
  dir: string;
  tracker: TrackerConfig;
  status: TaskStatus;
}

/**
 * As `updateStatus` for the task of `task.json` in the task dir; without the file, or with
 * `tracker: none` in it, it is skipped. A tracker that cannot be made is reported, not thrown.
 */
async function updateStatusOf(change: TaskDirStatus): Promise<StatusUpdate> {
  const { id, dir, tracker, status } = change;
  const task = await find(dir);
  if (task === null || task.tracker === TRACKER_KIND.none) return STATUS_SKIPPED;
  try {
    const made = makeTracker(tracker);
    return await updateStatus({ id, title: undefined }, made, status);
  } catch (e) {
    return failedState(e);
  }
}

/** Writes the state into `task.json` of `dir`; a missing file is left alone, an invalid one is `bad-file`. */
async function saveStatus(dir: string, status: string): Promise<void> {
  const task = await find(dir);
  if (task === null) return;
  await files.writeJson(taskFile(dir), { ...task, status });
}
