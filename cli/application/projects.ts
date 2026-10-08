import path from "node:path";
import { TenboxError } from "../domain/errors.ts";
import type { Manifest } from "../domain/manifest.ts";
import { type Project, projectName } from "../domain/project.ts";
import { git } from "../infra/git.ts";
import { manifests } from "./manifests.ts";

/** Projects on disk, found from any checkout in them. */
export const projects = { get };

export interface ProjectAndManifest {
  project: Project;
  /** The main checkout's manifest, without task layers. */
  manifest: Manifest;
}

/** The project that contains `cwd`, from the shared `.git` directory. */
async function get(cwd: string): Promise<ProjectAndManifest> {
  const commonDir = await git.findCommonDir(cwd);
  if (commonDir === null) throw new TenboxError(`${cwd} is not inside a git repository`, "no-repo");
  const mainDir = path.dirname(commonDir);
  const manifest = await manifests.get(mainDir);
  const project = { name: projectName(mainDir, manifest.project), mainDir, commonDir };
  return { project, manifest };
}
