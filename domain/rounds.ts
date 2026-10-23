import type { BuildStatus } from "./builds.ts";

/* A round: one pass of build, checks and review inside `/tenbox-build`; `rounds/<N>` holds it. */

/** `tenbox wait --for round` while a round runs: a new `checks.json`, no `build.json` yet. */
export const ROUND_RUNNING = "running";

/** `tenbox wait --for round`: the status of `build.json`, or `running`. */
export type RoundStatus = BuildStatus | typeof ROUND_RUNNING;

/** The round numbers among directory names, lowest first; other names are left out. */
export function roundNumbers(roundDirNames: string[]): number[] {
  const nums = roundDirNames.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return nums.sort((a, b) => a - b);
}

/** Highest round directory name plus one; 1 when there is none. */
export function nextRound(roundDirNames: string[]): number {
  const nums = roundNumbers(roundDirNames);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

/** Highest round directory name; 1 when there is none. */
export function currentRound(roundDirNames: string[]): number {
  return roundNumbers(roundDirNames).at(-1) ?? 1;
}
