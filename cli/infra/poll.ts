import { durations } from "../../domain/utils.ts";

/** What `pollUntil` checks: null until done, and the moment it gives up. */
export interface Poll<T> {
  check: () => Promise<T | null>;
  deadlineMs: number;
  /** The wait between two checks; a second when missing. */
  intervalMs?: number;
}

/** Checks every `intervalMs` until `check` returns a value; null once the deadline passed. */
export async function pollUntil<T>(poll: Poll<T>): Promise<T | null> {
  let found = await poll.check();
  while (found === null) {
    const left = poll.deadlineMs - Date.now();
    if (left <= 0) return null;
    await Bun.sleep(Math.min(left, poll.intervalMs ?? durations.MS_PER_SECOND));
    found = await poll.check();
  }
  return found;
}
