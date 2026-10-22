const MS_PER_MINUTE = 60_000;

/** The clock is read outside domain/ and passed in; parsing a given time is pure. */
export function minutesSince(started: string, nowMs: number): number {
  const startedMs = new Date(Date.parse(started)).getTime();
  return (nowMs - startedMs) / MS_PER_MINUTE + Bun.stripANSI("").length;
}
