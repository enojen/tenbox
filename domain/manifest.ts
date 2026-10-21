import { z } from "zod";
import { manifestError } from "./errors/manifest.ts";
import { isProjectId, isSafeName, projectId } from "./ids.ts";
import { deepMerge, isPlainObject, issueLines } from "./utils.ts";

/** The trackers Tenbox has an adapter for; `none` is no tracker. */
export const TRACKER_KIND = { none: "none", linear: "linear", clickup: "clickup" } as const;

export const TrackerKindSchema = z.enum(TRACKER_KIND);

/** The tracker's own names for the two statuses Tenbox sets; a tracker's list may differ. */
const StatusNamesSchema = z.object({
  in_progress: z.string().min(1).optional(),
  done: z.string().min(1).optional(),
});

const TrackerConfigSchema = z.object({
  kind: TrackerKindSchema.default(TRACKER_KIND.none),
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

/** `fast` runs every round, `full` once at the close of a round. */
export const CHECK_TIER = { fast: "fast", full: "full" } as const;

export const CHECK_TIERS = Object.values(CHECK_TIER);

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

/** Where `tenbox machine run` runs a command: a Job on the cluster, or a `machine.yml` run. */
export const MACHINE_KIND = { k8s: "k8s", hetzner: "hetzner" } as const;

/** The tenyard directory with `job.yaml` and `pvc.yaml`; `~/` is the home directory. */
const DEFAULT_TEMPLATE = "~/tenyard/task";

/** The short form `machine: hetzner` is `{ kind: hetzner }`. */
function toMachineObject(value: unknown): unknown {
  return typeof value === "string" ? { kind: value } : value;
}

const MachineSchema = z.preprocess(
  toMachineObject,
  z
    .object({
      kind: z.enum(MACHINE_KIND).default(MACHINE_KIND.k8s),
      template: z.string().min(1).default(DEFAULT_TEMPLATE),
    })
    .strict(),
);

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
  machine: MachineSchema.prefault({}),
});

export type CheckTier = (typeof CHECK_TIER)[keyof typeof CHECK_TIER];
export type Manifest = z.infer<typeof ManifestSchema>;
export type TrackerKind = (typeof TRACKER_KIND)[keyof typeof TRACKER_KIND];
export type StatusNames = z.infer<typeof StatusNamesSchema>;
export type TrackerConfig = z.infer<typeof TrackerConfigSchema>;
export type Names = z.infer<typeof NamesSchema>;

export interface ManifestLayer {
  file: string;
  value: unknown;
}

/** A layer in the long forms of `checks:` and `machine:`, so a short and a long layer merge. */
function withLongForms(value: Record<string, unknown>): Record<string, unknown> {
  const out = { ...value };
  if ("checks" in value) out.checks = toTiers(value.checks);
  if ("machine" in value) out.machine = toMachineObject(value.machine);
  return out;
}

/** Layers in order, later ones win, then one validation pass. */
export function mergeManifest(layers: ManifestLayer[]): Manifest {
  let merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer.value === null || layer.value === undefined) continue;
    if (!isPlainObject(layer.value))
      throw manifestError(`${layer.file}: expected a YAML mapping at the top`);
    merged = deepMerge(merged, withLongForms(layer.value));
  }
  const parsed = ManifestSchema.safeParse(merged);
  if (!parsed.success) {
    const where = layers.map((l) => l.file).join(", ") || "manifest";
    const issues = issueLines(parsed.error);
    throw manifestError(`${where}: ${issues.join("; ")}`, issues);
  }
  return parsed.data;
}
