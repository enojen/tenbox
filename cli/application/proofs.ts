import { readProofs, type StatsProof } from "../../domain/proof.ts";
import { proofsFile, tenboxDir } from "../../domain/task.ts";
import { files } from "../infra/files.ts";

/** Proofs: the worker proofs `tenbox proof` records in `.tenbox/proofs.json`, a JSON array. */
export const proofs = { read, append };

/** None when the file is missing; `bad-proofs` unless it is an array of valid proofs. */
async function read(taskWorktree: string): Promise<StatsProof[]> {
  const file = proofsFile(tenboxDir(taskWorktree));
  const text = await files.read(file);
  return text === null ? [] : readProofs(text, file);
}

/** Returns the path of `proofs.json`. */
async function append(taskWorktree: string, proof: StatsProof): Promise<string> {
  const recorded = await read(taskWorktree);
  const file = proofsFile(tenboxDir(taskWorktree));
  await files.writeJson(file, [...recorded, proof]);
  return file;
}
