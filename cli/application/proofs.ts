import { readProofs, type StatsProof } from "../../domain/proofs.ts";
import { proofsFile, tenboxDir } from "../../domain/taskDirs.ts";
import { files } from "../infra/files.ts";

/** Proofs: the worker proofs `tenbox proof` records in `.tenbox/proofs.json`, a JSON array. */
export const proofs = { read, append, appendAll };

/** None when the file is missing; `bad-file` unless it is an array of valid proofs. */
async function read(taskWorktree: string): Promise<StatsProof[]> {
  const file = proofsFile(tenboxDir(taskWorktree));
  const text = await files.read(file);
  return text === null ? [] : readProofs(text, file);
}

/** Returns the path of `proofs.json`. */
function append(taskWorktree: string, proof: StatsProof): Promise<string> {
  return appendAll(taskWorktree, [proof]);
}

/** Returns the path of `proofs.json`. */
async function appendAll(taskWorktree: string, added: StatsProof[]): Promise<string> {
  const recorded = await read(taskWorktree);
  const file = proofsFile(tenboxDir(taskWorktree));
  await files.writeJson(file, [...recorded, ...added]);
  return file;
}
