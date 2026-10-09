import { badProofsError } from "./errors/tasks.ts";
import { isFilled, isPlainObject, parseJson } from "./utils.ts";

/** One worker proof: the test that failed before the code, and how. */
export interface StatsProof {
  part: string;
  file: string;
  test: string;
  failure: string;
}

const PROOF_FIELDS = ["part", "file", "test", "failure"] as const;

/** Four non-blank strings: part, file, test and failure. */
export function isProof(item: unknown): item is StatsProof {
  return isPlainObject(item) && PROOF_FIELDS.every((field) => isFilled(item[field]));
}

/** The proof with every field trimmed, so padded and plain names are one test. */
export const trimProof = (proof: StatsProof): StatsProof => ({
  part: proof.part.trim(),
  file: proof.file.trim(),
  test: proof.test.trim(),
  failure: proof.failure.trim(),
});

/** The proofs in the text of `proofs.json`; `bad-proofs` unless it is an array of valid proofs. */
export function readProofs(text: string, file: string): StatsProof[] {
  const parsed = parseJson(text);
  if (parsed === undefined) throw badProofsError(file, "is not valid JSON");
  if (!Array.isArray(parsed)) throw badProofsError(file, "is not a JSON array");
  if (!parsed.every(isProof)) throw badProofsError(file, "has an item that is not a valid proof");
  return parsed;
}
