import { TenboxError } from "../../../domain/errors/index.ts";
import type { Tracker, TrackerTask } from "../../../domain/tracker.ts";

/** No tracker configured: `tenbox start <id> --title "..."` is the only way in. */
export const noneTracker: Tracker = {
  kind: "none",
  getTask(id): Promise<TrackerTask> {
    return Promise.reject(
      new TenboxError(
        `no tracker configured for ${id}; pass --title "..." or add tracker: to tenbox.yaml`,
        "no-tracker",
      ),
    );
  },
  updateStatus() {
    return Promise.resolve();
  },
};
