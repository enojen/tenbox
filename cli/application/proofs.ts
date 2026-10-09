import { TenboxError } from "../../domain/errors/index.ts";
import { isProof, type StatsProof } from "../../domain/proof.ts";
import { proofsFile, tenboxDir } from "../../domain/task.ts";
import { errorMessage } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

/** Proofs: the worker proofs `tenbox proof` records in `.tenbox/proofs.json`, a JSON array. */
export const proofs = { read, append };

/** None when the file is missing; `bad-proofs` unless it is an array of valid proofs. */
async function read(taskWorktree: string): Promise<StatsProof[]> {
  const file = proofsFile(tenboxDir(taskWorktree));
  const text = await files.read(file);
  if (text === null) return [];
  const parsed = parseJson(text, file);
  if (!Array.isArray(parsed)) throw new TenboxError(`${file} is not a JSON array`, "bad-proofs");
  if (!parsed.every(isProof)) {
    throw new TenboxError(`${file} has an item that is not a valid proof`, "bad-proofs");
  }
  return parsed;
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new TenboxError(`${file} is not valid JSON: ${errorMessage(e)}`, "bad-proofs");
  }
}

/** Returns the path of `proofs.json`. */
async function append(taskWorktree: string, proof: StatsProof): Promise<string> {
  const recorded = await read(taskWorktree);
  const file = proofsFile(tenboxDir(taskWorktree));
  await files.write(file, `${JSON.stringify([...recorded, proof], null, 2)}\n`);
  return file;
}
