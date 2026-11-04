import { noTrackerToWriteError } from "../../domain/errors/tools.ts";
import type { TaskId } from "../../domain/ids.ts";
import { TRACKER_KIND } from "../../domain/manifests.ts";
import { TASK_STATUS } from "../../domain/tracker.ts";
import { projects } from "../application/projects.ts";
import { env, log } from "../infra/env.ts";
import { makeTracker } from "../infra/tracker/index.ts";
import type { QueueResult } from "./results.ts";

/** Sets the tracker task to queued: it waits for a free slot and has no worktree yet. */
export async function queueTask(id: TaskId): Promise<QueueResult> {
  const { manifest } = await projects.get(env().cwd);
  if (manifest.tracker.kind === TRACKER_KIND.none) throw noTrackerToWriteError();
  const tracker = makeTracker(manifest.tracker);
  const status = await tracker.updateStatus(id, TASK_STATUS.queued);
  log(`${id} · ${status}`);
  return { ok: true, task: id, tracker: { kind: tracker.kind, status } };
}
