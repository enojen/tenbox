export const unique = <T>(items: T[]): T[] => [...new Set(items)];

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The JSON object in `text`; null when the text is not JSON or not an object. */
export function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Merge b over a: objects key by key, arrays and scalars replaced. */
export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] = isPlainObject(prev) && isPlainObject(v) ? deepMerge(prev, v) : v;
  }
  return out;
}

export const lastNonEmpty = <T extends string>(lines: T[]): T | undefined =>
  lines.findLast((line) => line !== "");

export const isDigits = (s: string): boolean => /^[0-9]+$/.test(s);

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const elapsedMs = (started: number): number => Math.round(performance.now() - started);

export const hasErrorCode = (e: unknown, codes: readonly string[]): boolean =>
  e instanceof Error && "code" in e && codes.includes(String(e.code));

export const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MINUTE_DECIMALS = 10;

/** Milliseconds as minutes with one decimal. */
export const toMinutes = (ms: number): number =>
  Math.round((ms / MS_PER_MINUTE) * MINUTE_DECIMALS) / MINUTE_DECIMALS;

/** Minutes between two ISO times; null when a time is missing. */
export function minutesBetween(from: string | null, to: string | null): number | null {
  if (from === null || to === null) return null;
  return toMinutes(Date.parse(to) - Date.parse(from));
}
