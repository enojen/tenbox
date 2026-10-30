import { readProofs, type StatsProof, withNewProofs } from "../../domain/proofs.ts";
import { proofsFile, tenboxDir } from "../../domain/taskDirs.ts";
import { files } from "../infra/files.ts";

/** Proofs: the worker proofs `tenbox proof` records in `.tenbox/proofs.json`, a JSON array. */
export const proofs = { read, append, appendNew };

/** None when the file is missing; `bad-file` unless it is an array of valid proofs. */
async function read(taskWorktree: string): Promise<StatsProof[]> {
  const file = proofsFile(tenboxDir(taskWorktree));
  const text = await files.read(file);
  return text === null ? [] : readProofs(text, file);
}

/** Returns the path of `proofs.json`. */
async function append(taskWorktree: string, proof: StatsProof): Promise<string> {
  const recorded = await read(taskWorktree);
  return write(taskWorktree, [...recorded, proof]);
}

/** Appends only the proofs `proofs.json` does not hold yet; returns its path. */
async function appendNew(taskWorktree: string, added: StatsProof[]): Promise<string> {
  const recorded = await read(taskWorktree);
  return write(taskWorktree, withNewProofs(recorded, added));
}

async function write(taskWorktree: string, all: StatsProof[]): Promise<string> {
  const file = proofsFile(tenboxDir(taskWorktree));
  await files.writeJson(file, all);
  return file;
}
