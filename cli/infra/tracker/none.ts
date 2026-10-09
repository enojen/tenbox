import { noTrackerError } from "../../../domain/errors/tools.ts";
import type { Tracker, TrackerTask } from "../../../domain/tracker.ts";

/** No tracker configured: `tenbox start <id> --title "..."` is the only way in. */
export const noneTracker: Tracker = {
  kind: "none",
  getTask(id): Promise<TrackerTask> {
    return Promise.reject(noTrackerError(id));
  },
  updateStatus() {
    return Promise.resolve();
  },
};
