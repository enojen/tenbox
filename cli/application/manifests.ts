import path from "node:path";
import { errorMessage } from "../../domain/errors/index.ts";
import { manifestError, manifestNotCommittedError } from "../../domain/errors/manifest.ts";
import { newProjectId, type ProjectId, projectId } from "../../domain/ids.ts";
import { type Manifest, type ManifestLayer, mergeManifest } from "../../domain/manifest.ts";
import { objects } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";

/** The manifest of a project: `tenbox.yaml` and its local layers. */
export const manifests = { get, ensureId, requireCommitted };

/**
 * Layers, later ones win:
 * tenbox.yaml (task worktree, else main) → tenbox.local.yaml (main, then task) → .tenbox/override.yaml (task)
 */
async function get(mainDir: string, taskWorktree?: string): Promise<Manifest> {
  const loaded = await Promise.all(manifestPaths(mainDir, taskWorktree).map(yamlLayer));
  const layers = loaded.filter((layer) => layer !== null);
  for (const layer of layers) rejectLocalId(layer);
  return mergeManifest(layers);
}

/** The id counts only from the `tenbox.yaml` in the main checkout; every machine sees that one. */
async function ensureId(mainDir: string): Promise<ProjectId> {
  const file = path.join(mainDir, "tenbox.yaml");
  const text = await files.read(file);
  const value = text === null ? null : parseYaml(file, text);
  const existing = objects.isRecord(value) ? value.id : undefined;
  if (typeof existing === "string") return projectId(existing);
  const id = newProjectId();
  const separator = text === null || text === "" || text.endsWith("\n") ? "" : "\n";
  await files.write(file, `${text ?? ""}${separator}id: "${id}"\n`);
  return id;
}

/** A task worktree gets `tenbox.yaml` from the base; a file that is not there would be missing. */
async function requireCommitted(mainDir: string, base: string): Promise<void> {
  const onBase = await git.refExists(mainDir, `${base}:tenbox.yaml`);
  const changed = await git.hasFileChanges(mainDir, "tenbox.yaml");
  if (!onBase || changed) throw manifestNotCommittedError(base);
}

function rejectLocalId(layer: ManifestLayer): void {
  if (path.basename(layer.file) === "tenbox.yaml") return;
  if (!objects.isRecord(layer.value) || !("id" in layer.value)) return;
  throw manifestError(`${layer.file}: id belongs in tenbox.yaml`);
}

function manifestPaths(mainDir: string, taskWorktree?: string): string[] {
  const paths = [
    path.join(taskWorktree ?? mainDir, "tenbox.yaml"),
    path.join(mainDir, "tenbox.local.yaml"),
  ];
  if (!taskWorktree) return paths;
  if (taskWorktree !== mainDir) {
    paths.push(path.join(taskWorktree, "tenbox.local.yaml"));
  }
  paths.push(path.join(taskWorktree, ".tenbox", "override.yaml"));
  return paths;
}

async function yamlLayer(file: string): Promise<ManifestLayer | null> {
  const text = await files.read(file);
  if (text === null) return null;
  return { file, value: parseYaml(file, text) };
}

function parseYaml(file: string, text: string): unknown {
  try {
    return Bun.YAML.parse(text);
  } catch (e) {
    throw manifestError(`${file}: ${errorMessage(e)}`);
  }
}
