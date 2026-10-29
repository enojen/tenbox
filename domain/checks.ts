import { z } from "zod";
import { badFileError } from "./errors/index.ts";
import { BaselineSourceSchema } from "./failures.ts";
import { CHECK_TIERS } from "./manifests.ts";
import { jsons } from "./utils.ts";

const BaselineSummarySchema = z.object({
  sha: z.string(),
  source: BaselineSourceSchema,
  failures: z.number(),
});

/** One check, judged against its baseline. */
const CheckOutcomeSchema = z.object({
  name: z.string(),
  cmd: z.string(),
  exit_code: z.number(),
  duration_ms: z.number(),
  timed_out: z.boolean(),
  failures: z.number(),
  new_failures: z.array(z.string()),
  /** New failures of the first run that the rerun did not repeat; they do not fail the check. */
  flaky: z.array(z.string()),
  fixed: z.array(z.string()),
  baseline: BaselineSummarySchema,
});

const CheckRunSchema = CheckOutcomeSchema.extend({ log: z.string() });

const BaseInfoSchema = z.object({ ref: z.string(), sha: z.string() });

/** What `tenbox check` writes to a round's `checks.json` (`checks-full.json` for `full`). */
const CheckResultSchema = z.object({
  ok: z.boolean(),
  task: z.string(),
  round: z.number(),
  worktree: z.string(),
  commit: z.string(),
  base: BaseInfoSchema,
  checks: z.array(CheckRunSchema),
  summary: z.string(),
  file: z.string(),
  tier: z.enum(CHECK_TIERS),
});

export type CheckOutcome = z.infer<typeof CheckOutcomeSchema>;
export type CheckRun = z.infer<typeof CheckRunSchema>;
export type BaseInfo = z.infer<typeof BaseInfoSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;

/** Only `ok`: stats read it from every round, also from a `checks.json` written before `tier` or `flaky`. */
const CheckOkSchema = z.looseObject({ ok: z.boolean() });

/** `ok` in the text of `checks.json`; `bad-file` when it is not JSON or has no boolean `ok`. */
export function readCheckOk(text: string, file: string): boolean {
  const result = jsons.check(CheckOkSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value.ok;
}

/** The check result in the text of `checks.json`; `bad-file` when it is not JSON or does not match. */
export function readCheckResult(text: string, file: string): CheckResult {
  const result = jsons.check(CheckResultSchema, text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}
