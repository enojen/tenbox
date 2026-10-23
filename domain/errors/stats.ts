import { TenboxError } from "./index.ts";

/* Errors of `tenbox stats`. */

export function noStatsError(id: string): TenboxError {
  return new TenboxError(
    `${id} has no stats.json and no Claude Code session files; run: tenbox start ${id}`,
    "no-stats",
  );
}

export function oldStatsError(id: string): TenboxError {
  return new TenboxError(
    `${id} has a stats.json of an older schema without token numbers and no Claude Code session files`,
    "old-stats",
  );
}
