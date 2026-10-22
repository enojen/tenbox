/**
 * Generic helpers. Only pure, general functions belong here: no Tenbox concept, no clock,
 * no file system, no process.
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { issueLines } from "./errors/index.ts";

/** The JSON value in `text`; undefined when the text is not JSON. */
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The value of a JSON text that fits a schema. */
interface JsonValid<T> {
  ok: true;
  value: T;
}

/** Why a JSON text does not fit a schema: `not JSON`, or one line per issue. */
interface JsonInvalid {
  ok: false;
  issues: string[];
}

type JsonCheck<T> = JsonValid<T> | JsonInvalid;

const NOT_JSON = "not JSON";

/** The text checked against the schema; never throws. */
function check<T>(schema: z.ZodType<T>, text: string): JsonCheck<T> {
  const value = parse(text);
  if (value === undefined) return { ok: false, issues: [NOT_JSON] };
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, issues: issueLines(parsed.error) };
}

/** The lines of a JSON Lines text that fit a schema, and how many did not. */
interface JsonLines<T> {
  values: T[];
  skipped: number;
}

/**
 * Each non-empty line checked against the schema; never throws. A last line with no newline
 * after it may still be written: it is kept when it fits and not counted when it does not.
 */
function checkLines<T>(schema: z.ZodType<T>, text: string): JsonLines<T> {
  const lines = text.split("\n");
  const last = lines.length - 1;
  const result: JsonLines<T> = { values: [], skipped: 0 };
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const checked = check(schema, line);
    if (checked.ok) result.values.push(checked.value);
    else if (index < last) result.skipped += 1;
  });
  return result;
}

/** JSON values. */
export const jsons = { parse, check, checkLines };

/** Objects: a record is an object that is not null and not an array, from JSON or YAML. */
export const objects = {
  isRecord: (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v),
};

/** Strings: blank means empty or only whitespace; a whole number is only the digits 0-9. */
export const strings = {
  isNotBlank: (value: unknown): value is string => typeof value === "string" && value.trim() !== "",
  isWholeNumber: (s: string): boolean => /^[0-9]+$/.test(s),
  lastNonEmptyLine: <T extends string>(lines: T[]): T | undefined =>
    lines.findLast((line) => line !== ""),
};

export const lists = {
  unique: <T>(items: T[]): T[] => [...new Set(items)],
};

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MINUTE_DECIMALS = 10;

/** Milliseconds as minutes with one decimal. */
const msToMinutes = (ms: number): number =>
  Math.round((ms / MS_PER_MINUTE) * MINUTE_DECIMALS) / MINUTE_DECIMALS;

/** Minutes between two ISO times; null when a time is missing. */
function minutesBetween(from: string | null, to: string | null): number | null {
  if (from === null || to === null) return null;
  return msToMinutes(Date.parse(to) - Date.parse(from));
}

export const durations = { MS_PER_SECOND, msToMinutes, minutesBetween };

export const hashes = {
  sha256Hex: (text: string): string => createHash("sha256").update(text).digest("hex"),
};
