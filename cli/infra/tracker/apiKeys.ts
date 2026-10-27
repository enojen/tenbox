import { TRACKER_KIND, type TrackerConfig, type TrackerKind } from "../../../domain/manifests.ts";

/** The trackers that take a key; `github` uses the login of `gh`. */
const KEY_ENV: Partial<Record<TrackerKind, string>> = {
  [TRACKER_KIND.linear]: "LINEAR_API_KEY",
  [TRACKER_KIND.clickup]: "CLICKUP_API_KEY",
};

/** `tracker.api_key`, else the tracker's env variable; null for a tracker without a key or when neither is set. */
export function findApiKey(config: TrackerConfig): string | null {
  const envName = KEY_ENV[config.kind];
  if (!envName) return null;
  return config.api_key || process.env[envName] || null;
}
