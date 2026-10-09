import { z } from "zod";
import { manifestError } from "./errors/manifest.ts";
import { isProjectId, isSafeName, projectId } from "./ids.ts";
import { deepMerge, isPlainObject } from "./utils.ts";

const TrackerKindSchema = z.enum(["none", "linear"]);

const TrackerConfigSchema = z.object({
  kind: TrackerKindSchema.default("none"),
  api_key: z.string().optional(),
});

const ID_PLACEHOLDER = "{id}";
const GIT_REF_FORBIDDEN = [" ", "\t", "~", "^", ":", "?", "*", "[", "\\", ".."];
const TMUX_FORBIDDEN = [".", ":"];

function hasOnePlaceholder(template: string): boolean {
  return template.split(ID_PLACEHOLDER).length === 2;
}

function usesNone(forbidden: string[]): (template: string) => boolean {
  return (template) => !forbidden.some((piece) => template.includes(piece));
}

function nameTemplate(forbidden: string[], tool: string) {
  return z
    .string()
    .min(1)
    .refine(hasOnePlaceholder, { message: `must contain ${ID_PLACEHOLDER} exactly once` })
    .refine(usesNone(forbidden), { message: `contains characters ${tool} does not allow` });
}

/** `{id}` is replaced with the task id. */
export const NamesSchema = z.object({
  branch: nameTemplate(GIT_REF_FORBIDDEN, "git").default("feat/{id}"),
  tmux: nameTemplate(TMUX_FORBIDDEN, "tmux").default("tenbox-{id}"),
});

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

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
  checks: z.record(z.string(), z.string().min(1)).default({}),
  tracker: TrackerConfigSchema.prefault({}),
  names: NamesSchema.prefault({}),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type TrackerKind = z.infer<typeof TrackerKindSchema>;
export type TrackerConfig = z.infer<typeof TrackerConfigSchema>;
export type Names = z.infer<typeof NamesSchema>;

export interface ManifestLayer {
  file: string;
  value: unknown;
}

/** Layers in order, later ones win, then one validation pass. */
export function mergeManifest(layers: ManifestLayer[]): Manifest {
  let merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer.value === null || layer.value === undefined) continue;
    if (!isPlainObject(layer.value))
      throw manifestError(`${layer.file}: expected a YAML mapping at the top`);
    merged = deepMerge(merged, layer.value);
  }
  const parsed = ManifestSchema.safeParse(merged);
  if (!parsed.success) {
    const where = layers.map((l) => l.file).join(", ") || "manifest";
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw manifestError(`${where}: ${issues.join("; ")}`, issues);
  }
  return parsed.data;
}
