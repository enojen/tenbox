import path from "node:path";
import { TenboxError } from "../../domain/errors/index.ts";
import { newProjectId, type ProjectId, projectId } from "../../domain/ids.ts";
import { type Manifest, type ManifestLayer, mergeManifest } from "../../domain/manifest.ts";
import { errorMessage, isPlainObject } from "../../domain/utils.ts";
import { log } from "../infra/env.ts";
import { files } from "../infra/files.ts";

/** The manifest of a project: `tenbox.yaml` and its local layers. */
export const manifests = { get, ensureId };

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
  const existing = isPlainObject(value) ? value.id : undefined;
  if (typeof existing === "string") return projectId(existing);
  const id = newProjectId();
  const separator = text === null || text === "" || text.endsWith("\n") ? "" : "\n";
  await files.write(file, `${text ?? ""}${separator}id: ${id}\n`);
  log("tenbox.yaml now has a project id: commit tenbox.yaml");
  return id;
}

function rejectLocalId(layer: ManifestLayer): void {
  if (path.basename(layer.file) === "tenbox.yaml") return;
  if (!isPlainObject(layer.value) || !("id" in layer.value)) return;
  throw new TenboxError(`${layer.file}: id belongs in tenbox.yaml`, "manifest");
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
    throw new TenboxError(`${file}: ${errorMessage(e)}`, "manifest");
  }
}
