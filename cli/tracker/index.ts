import { TenboxError } from "../domain/errors.ts";
import type { TrackerConfig } from "../domain/manifest.ts";
import type { Tracker } from "../ports.ts";
import { linearTracker } from "./linear.ts";
import { noneTracker } from "./none.ts";

export function makeTracker(config: TrackerConfig): Tracker {
  switch (config.kind) {
    case "none":
      return noneTracker;
    case "linear":
      return linearTracker(config);
  }
}
