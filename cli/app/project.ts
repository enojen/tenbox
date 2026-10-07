import path from "node:path";
import { TenboxError } from "../domain/errors.ts";
import { type TaskId, taskBranch } from "../domain/ids.ts";
import { type Manifest, type ManifestLayer, mergeManifest } from "../domain/manifest.ts";
import { type Project, projectName, taskWorktreeDir } from "../domain/project.ts";
import type { Files, Git, Ports } from "../ports.ts";

async function yamlLayer(files: Files, file: string): Promise<ManifestLayer | null> {
  const text = await files.read(file);
  if (text === null) return null;
  try {
    return { file, value: Bun.YAML.parse(text) };
  } catch (e) {
    throw new TenboxError(`${file}: ${(e as Error).message}`, "manifest");
  }
}

/**
 * Layers, later ones win:
 * tenbox.yaml (task worktree, else main) → tenbox.local.yaml (main, then task) → .tenbox/override.yaml (task)
 */
export async function loadManifest(files: Files, mainDir: string, taskDir?: string): Promise<Manifest> {
  const candidates = [path.join(taskDir ?? mainDir, "tenbox.yaml"), path.join(mainDir, "tenbox.local.yaml")];
  if (taskDir && taskDir !== mainDir) candidates.push(path.join(taskDir, "tenbox.local.yaml"));
  if (taskDir) candidates.push(path.join(taskDir, ".tenbox", "override.yaml"));
  const layers: ManifestLayer[] = [];
  for (const f of candidates) {
    const layer = await yamlLayer(files, f);
    if (layer) layers.push(layer);
  }
  return mergeManifest(layers);
}

/** The project that contains `cwd`, from the shared `.git` directory. */
export async function findProject(git: Git, files: Files, cwd: string): Promise<Project> {
  const common = await git.try(["rev-parse", "--git-common-dir"], cwd);
  if (common === null) throw new TenboxError(`${cwd} is not inside a git repository`, "no-repo");
  const commonDir = path.resolve(cwd, common);
  const mainDir = path.dirname(commonDir);
  const manifest = await loadManifest(files, mainDir);
  return { name: projectName(mainDir, manifest.project), mainDir, commonDir };
}

/** The task's worktree: the current one when it is the task's, else `~/wt/<project>/<id>`. */
export async function resolveTaskDir(ports: Ports, id: TaskId): Promise<string> {
  const { git, files, env } = ports;
  const top = await git.try(["rev-parse", "--show-toplevel"], env.cwd);
  if (top) {
    const project = await findProject(git, files, top);
    const manifest = await loadManifest(files, project.mainDir);
    const branch = await git.try(["rev-parse", "--abbrev-ref", "HEAD"], top);
    if (branch === taskBranch(manifest.names, id) || path.basename(top) === id) return top;
    const dir = taskWorktreeDir(env.wtRoot, project.name, id);
    if (await files.isDir(dir)) return dir;
  }
  for (const project of await files.list(env.wtRoot)) {
    const dir = path.join(env.wtRoot, project, id);
    if (await files.isDir(path.join(dir, ".tenbox"))) return dir;
  }
  throw new TenboxError(`no worktree for ${id}; run: tenbox start ${id}`, "no-worktree");
}

