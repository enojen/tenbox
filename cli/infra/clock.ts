/** Milliseconds since `started`, a `performance.now()` value, rounded. */
export const elapsedMs = (started: number): number => Math.round(performance.now() - started);
