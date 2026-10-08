import { TenboxError } from "../../domain/errors.ts";
import type { Tracker, TrackerTask } from "../../domain/tracker.ts";

/** No tracker configured: `tenbox start <id> --title "..."` is the only way in. */
export const noneTracker: Tracker = {
  kind: "none",
  async getTask(id): Promise<TrackerTask> {
    throw new TenboxError(
      `no tracker configured for ${id}; pass --title "..." or add tracker: to tenbox.yaml`,
      "no-tracker",
    );
  },
  async updateStatus() {},
};
