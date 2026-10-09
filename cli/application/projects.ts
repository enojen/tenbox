import path from "node:path";
import { TenboxError } from "../../domain/errors.ts";
import type { Manifest } from "../../domain/manifest.ts";
import type { ProjectId } from "../../domain/ids.ts";
import { type Project, projectDir, projectName } from "../../domain/project.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { manifests } from "./manifests.ts";

/** Projects on disk, found from any checkout in them. */
export const projects = { get, save };

export interface ProjectAndManifest {
  project: Project;
  /** The main checkout's manifest, without task layers. */
  manifest: Manifest;
}

/** The project that contains `cwd`, from the shared `.git` directory. */
async function get(cwd: string): Promise<ProjectAndManifest> {
  const commonDir = await git.findCommonDir(cwd);
  const mainDir = await git.findMainDir(cwd);
  if (commonDir === null || mainDir === null) {
    throw new TenboxError(`${cwd} is not inside a git repository`, "no-repo");
  }
  const manifest = await manifests.get(mainDir);
  const project = { name: projectName(mainDir, manifest.project), mainDir, commonDir };
  return { project, manifest };
}

export interface ProjectRecord {
  id: ProjectId;
  name: string;
}

/** Writes `project.json` in the project's folder under `tenboxHome`; the name can change. */
async function save(tenboxHome: string, record: ProjectRecord): Promise<void> {
  const file = path.join(projectDir(tenboxHome, record.id), "project.json");
  await files.write(file, `${JSON.stringify(record)}\n`);
}
