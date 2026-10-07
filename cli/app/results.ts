import { z } from "zod";
import { TrackerKindSchema } from "../domain/manifest.ts";

/* Command outputs. One schema each: the TS type for the CLI, the JSON Schema for workflows. */

export const SetupResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ran"), cmd: z.string(), exit_code: z.number(), duration_ms: z.number() }),
  z.object({ state: z.literal("skipped"), reason: z.string() }),
]);

export const StartResultSchema = z.object({
  ok: z.literal(true),
  task: z.string(),
  title: z.string(),
  project: z.string(),
  worktree: z.string(),
  branch: z.string(),
  base: z.string(),
  created: z.boolean(),
  task_md: z.string(),
  setup: SetupResultSchema,
  tracker: z.object({ kind: TrackerKindSchema, status: z.string() }),
  tmux: z.object({ session: z.string(), state: z.enum(["started", "exists", "skipped", "unavailable"]), attach: z.string() }),
});

export const CheckRunSchema = z.object({
  name: z.string(),
  cmd: z.string(),
  exit_code: z.number(),
  duration_ms: z.number(),
  timed_out: z.boolean(),
  failures: z.number(),
  new_failures: z.array(z.string()),
  fixed: z.array(z.string()),
  baseline: z.object({ sha: z.string(), source: z.enum(["exact", "newest", "main", "none"]), failures: z.number() }),
  log: z.string(),
});

export const CheckResultSchema = z.object({
  ok: z.boolean(),
  task: z.string(),
  round: z.number(),
  worktree: z.string(),
  commit: z.string(),
  base: z.object({ ref: z.string(), sha: z.string() }),
  checks: z.array(CheckRunSchema),
  summary: z.string(),
  file: z.string(),
});

export const LinkEntrySchema = z.object({
  name: z.string(),
  source: z.string(),
  link: z.string(),
  state: z.enum(["linked", "unchanged", "skipped"]),
});

/** `ok` is false when a link was skipped; like `check`, the exit code stays 0. */
export const InstallResultSchema = z.object({
  ok: z.boolean(),
  claude_dir: z.string(),
  links: z.array(LinkEntrySchema),
});

export const FailureSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
});

export type SetupResult = z.infer<typeof SetupResultSchema>;
export type StartResult = z.infer<typeof StartResultSchema>;
export type CheckRun = z.infer<typeof CheckRunSchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type LinkEntry = z.infer<typeof LinkEntrySchema>;
export type InstallResult = z.infer<typeof InstallResultSchema>;
export type Failure = z.infer<typeof FailureSchema>;
