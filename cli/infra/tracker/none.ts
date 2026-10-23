import { noTrackerError } from "../../../domain/errors/tools.ts";
import { TRACKER_KIND } from "../../../domain/manifests.ts";
import type { Tracker, TrackerTask } from "../../../domain/tracker.ts";

/** No tracker configured: `tenbox start <id> --title "..."` is the only way in. */
export const noneTracker: Tracker = {
  kind: TRACKER_KIND.none,
  getTask(id): Promise<TrackerTask> {
    return Promise.reject(noTrackerError(id));
  },
  updateStatus() {
    return Promise.resolve("");
  },
  comments() {
    return Promise.resolve([]);
  },
  comment() {
    return Promise.resolve();
  },
};
