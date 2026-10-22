import type { z } from "zod";
import { jsons } from "../../../domain/utils.ts";
import { log } from "../env.ts";
import { files } from "../files.ts";

/*
 * Files that Claude Code writes (not a public API): their format can change under us. A missing
 * file is null; a broken one is null too, with one warning line on stderr, so a change in
 * Claude Code does not stop a tenbox command. The schemas name only the fields Tenbox reads.
 */
export const claudeFiles = { find, findLines };

/** The value of a JSON file that fits the schema; null when it is missing or does not fit. */
async function find<T>(schema: z.ZodType<T>, file: string): Promise<T | null> {
  const text = await files.read(file);
  if (text === null) return null;
  const checked = jsons.check(schema, text);
  if (checked.ok) return checked.value;
  log(`warning: ${file}: ${checked.issues.join("; ")}`);
  return null;
}

/** The lines of a JSON Lines file that fit the schema; null when it is missing. */
async function findLines<T>(schema: z.ZodType<T>, file: string): Promise<T[] | null> {
  const text = await files.read(file);
  if (text === null) return null;
  const { values, skipped } = jsons.checkLines(schema, text);
  if (skipped > 0) log(`warning: ${file}: ${skipped} line(s) skipped`);
  return values;
}
