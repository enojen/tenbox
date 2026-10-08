import path from "node:path";
import { TenboxError } from "../../domain/errors.ts";
import { type Manifest, type ManifestLayer, mergeManifest } from "../../domain/manifest.ts";
import { errorMessage } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

/** The manifest of a project: `tenbox.yaml` and its local layers. */
export const manifests = { get };

/**
 * Layers, later ones win:
 * tenbox.yaml (task worktree, else main) → tenbox.local.yaml (main, then task) → .tenbox/override.yaml (task)
 */
async function get(mainDir: string, taskWorktree?: string): Promise<Manifest> {
  const layers = await Promise.all(manifestPaths(mainDir, taskWorktree).map(yamlLayer));
  return mergeManifest(layers.filter((layer) => layer !== null));
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
  try {
    return { file, value: Bun.YAML.parse(text) };
  } catch (e) {
    throw new TenboxError(`${file}: ${errorMessage(e)}`, "manifest");
  }
}
