import { TRACKER_KIND, type TrackerConfig } from "../../../domain/manifests.ts";

const KEY_ENV = {
  [TRACKER_KIND.linear]: "LINEAR_API_KEY",
  [TRACKER_KIND.clickup]: "CLICKUP_API_KEY",
};

/** `tracker.api_key`, else the tracker's env variable; null for `none` or when neither is set. */
export function findApiKey(config: TrackerConfig): string | null {
  if (config.kind === TRACKER_KIND.none) return null;
  return config.api_key || process.env[KEY_ENV[config.kind]] || null;
}
