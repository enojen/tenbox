import { addDeadline } from "../../domain/answers.ts";
import { type BuildResult, buildFile, parseBuild, readBuild } from "../../domain/build.ts";
import { trimProof } from "../../domain/proof.ts";
import { tenboxDir } from "../../domain/task.ts";
import { files } from "../infra/files.ts";
import { proofs } from "./proofs.ts";

/** Builds: the last build result, `build.json` in the task dir. */
export const builds = { save, update, find };

/**
 * Writes `build.json` and returns its path; `bad-build` when the text is not a valid result.
 * The proofs go to `proofs.json`; the earlier unproven items stay first. A decision card gets
 * its `deadline` from now.
 */
async function save(taskWorktree: string, buildText: string): Promise<string> {
  const result = addDeadline(parseBuild(buildText), new Date());
  const earlier = await find(tenboxDir(taskWorktree));
  await proofs.appendAll(taskWorktree, result.proofs.map(trimProof));
  const unproven = [...(earlier?.unproven ?? []), ...result.unproven];
  const file = buildFile(tenboxDir(taskWorktree));
  await files.writeJson(file, { ...result, unproven });
  return file;
}

/** Writes the changed result, such as an `answered` card, back to `build.json` as it is. */
async function update(taskWorktree: string, result: BuildResult): Promise<void> {
  await files.writeJson(buildFile(tenboxDir(taskWorktree)), result);
}

/** The build result in `dir`; null when `build.json` is missing or not valid. */
async function find(dir: string): Promise<BuildResult | null> {
  const text = await files.read(buildFile(dir));
  return text === null ? null : readBuild(text);
}
