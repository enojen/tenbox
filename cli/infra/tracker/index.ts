import { trackerUnsupportedError } from "../../../domain/errors/tools.ts";
import { TRACKER_KIND, type TrackerConfig } from "../../../domain/manifests.ts";
import type { TaskPlace, Tracker } from "../../../domain/tracker.ts";
import { clickupTracker } from "./clickup.ts";
import { githubTracker } from "./github.ts";
import { linearTracker } from "./linear.ts";
import { noneTracker } from "./none.ts";

/**
 * The only place in Tenbox that knows which tracker a project uses. `place` moves the tasks it
 * opens: `list` stands for `tracker.list` of ClickUp and `tracker.team` of Linear; GitHub Issues
 * has neither and refuses both.
 */
export function makeTracker(config: TrackerConfig, place: TaskPlace = {}): Tracker {
  const { list, parent } = place;
  switch (config.kind) {
    case TRACKER_KIND.none:
      return noneTracker;
    case TRACKER_KIND.linear:
      return linearTracker({ ...config, ...(list && { team: list }) }, parent);
    case TRACKER_KIND.clickup:
      return clickupTracker({ ...config, ...(list && { list }) }, parent);
    case TRACKER_KIND.github:
      if (list !== undefined || parent !== undefined)
        throw trackerUnsupportedError("GitHub Issues");
      return githubTracker;
  }
}
