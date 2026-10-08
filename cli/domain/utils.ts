export const unique = <T>(items: T[]): T[] => [...new Set(items)];

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

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
