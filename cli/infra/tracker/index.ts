import { TRACKER_KIND, type TrackerConfig } from "../../../domain/manifests.ts";
import type { Tracker } from "../../../domain/tracker.ts";
import { clickupTracker } from "./clickup.ts";
import { linearTracker } from "./linear.ts";
import { noneTracker } from "./none.ts";

/** The only place in Tenbox that knows which tracker a project uses. */
export function makeTracker(config: TrackerConfig): Tracker {
  switch (config.kind) {
    case TRACKER_KIND.none:
      return noneTracker;
    case TRACKER_KIND.linear:
      return linearTracker(config);
    case TRACKER_KIND.clickup:
      return clickupTracker(config);
  }
}
