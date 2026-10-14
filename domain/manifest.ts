import { z } from "zod";
import { manifestError } from "./errors/manifest.ts";
import { isProjectId, isSafeName, projectId } from "./ids.ts";
import { deepMerge, isPlainObject, issueLines } from "./utils.ts";

export const TrackerKindSchema = z.enum(["none", "linear", "clickup"]);

/** The tracker's own names for the two statuses Tenbox sets; a tracker's list may differ. */
const StatusNamesSchema = z.object({
  in_progress: z.string().min(1).optional(),
  done: z.string().min(1).optional(),
});

const TrackerConfigSchema = z.object({
  kind: TrackerKindSchema.default("none"),
  api_key: z.string().optional(),
  statuses: StatusNamesSchema.optional(),
});

const ID_PLACEHOLDER = "{id}";
const GIT_REF_FORBIDDEN = [" ", "\t", "~", "^", ":", "?", "*", "[", "\\", ".."];

function hasOnePlaceholder(template: string): boolean {
  return template.split(ID_PLACEHOLDER).length === 2;
}

function usesNone(forbidden: string[]): (template: string) => boolean {
  return (template) => !forbidden.some((piece) => template.includes(piece));
}

function nameTemplate() {
  return z
    .string()
    .min(1)
    .refine(hasOnePlaceholder, { message: `must contain ${ID_PLACEHOLDER} exactly once` });
}

/** `{id}` is replaced with the task id. */
export const NamesSchema = z
  .object({
    branch: nameTemplate()
      .refine(usesNone(GIT_REF_FORBIDDEN), { message: "contains characters git does not allow" })
      .default("feat/{id}"),
    session: nameTemplate().default("tenbox-{id}"),
  })
  .strict();

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

const CheckCommandsSchema = z.record(z.string(), z.string().min(1));

export const CHECK_TIERS = ["fast", "full"] as const;

function isTiered(value: Record<string, unknown>): boolean {
  return CHECK_TIERS.some((tier) => isPlainObject(value[tier]));
}

/** The flat form `{ name: cmd }` is the `fast` tier. */
function toTiers(value: unknown): unknown {
  if (!isPlainObject(value) || isTiered(value)) return value;
  return { fast: value };
}

function namesInBothTiers(checks: { fast: Record<string, string>; full: Record<string, string> }) {
  return Object.keys(checks.fast).filter((name) => name in checks.full);
}

/** `fast` runs every round, `full` once at the close of a round; a name is in one tier only. */
const ChecksSchema = z.preprocess(
  toTiers,
  z
    .object({
      fast: CheckCommandsSchema.default({}),
      full: CheckCommandsSchema.default({}),
    })
    .strict()
    .superRefine((checks, ctx) => {
      for (const name of namesInBothTiers(checks)) {
        ctx.addIssue({ code: "custom", message: `check "${name}" is in both tiers`, path: [name] });
      }
    }),
);

/** Where Tenbox sends the one-line notifications; without `ntfy` it sends none. */
const NotifySchema = z.object({ ntfy: z.url().optional() }).strict();

/** `tenbox.yaml`, phase 1 subset. Keys of later phases are dropped until `tenbox validate`. */
const ManifestSchema = z.object({
  id: z
    .string()
    .refine(isProjectId, { message: "6 characters, a-z and 0-9" })
    .transform(projectId)
    .optional(),
  // Becomes a directory under the worktree root: `../x` would escape it.
  project: z.string().refine(isSafeName, { message: "letters, digits, _ and - only" }).optional(),
  setup: z.string().min(1).optional(),
  /** The branch tasks start from and merge into. */
  base: z.string().min(1).default("main"),
  failure_pattern: z
    .string()
    .min(1)
    .refine(compiles, { message: "not a valid regular expression" })
    .optional(),
  /** The `--model` of the task's `claude` session. */
  model: z.string().min(1).default("sonnet"),
  checks: ChecksSchema.default({ fast: {}, full: {} }),
  tracker: TrackerConfigSchema.prefault({}),
  names: NamesSchema.prefault({}),
  notify: NotifySchema.prefault({}),
});

export type CheckTier = (typeof CHECK_TIERS)[number];
export type Manifest = z.infer<typeof ManifestSchema>;
export type TrackerKind = z.infer<typeof TrackerKindSchema>;
export type StatusNames = z.infer<typeof StatusNamesSchema>;
export type TrackerConfig = z.infer<typeof TrackerConfigSchema>;
export type Names = z.infer<typeof NamesSchema>;

export interface ManifestLayer {
  file: string;
  value: unknown;
}

/** A layer whose flat `checks:` is turned into tiers, so a flat and a tiered layer merge. */
function withTiers(value: Record<string, unknown>): Record<string, unknown> {
  if (!("checks" in value)) return value;
  return { ...value, checks: toTiers(value.checks) };
}

/** Layers in order, later ones win, then one validation pass. */
export function mergeManifest(layers: ManifestLayer[]): Manifest {
  let merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer.value === null || layer.value === undefined) continue;
    if (!isPlainObject(layer.value))
      throw manifestError(`${layer.file}: expected a YAML mapping at the top`);
    merged = deepMerge(merged, withTiers(layer.value));
  }
  const parsed = ManifestSchema.safeParse(merged);
  if (!parsed.success) {
    const where = layers.map((l) => l.file).join(", ") || "manifest";
    const issues = issueLines(parsed.error);
    throw manifestError(`${where}: ${issues.join("; ")}`, issues);
  }
  return parsed.data;
}
