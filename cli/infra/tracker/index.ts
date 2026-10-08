import type { TrackerConfig } from "../../domain/manifest.ts";
import type { Tracker } from "../../domain/tracker.ts";
import { linearTracker } from "./linear.ts";
import { noneTracker } from "./none.ts";

/** The only place in Tenbox that knows which tracker a project uses. */
export function makeTracker(config: TrackerConfig): Tracker {
  switch (config.kind) {
    case "none":
      return noneTracker;
    case "linear":
      return linearTracker(config);
  }
}
