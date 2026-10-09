import { z } from "zod";
import { badProofsError } from "./errors/tasks.ts";
import { isFilled, parseJson } from "./utils.ts";

const filled = z.string().refine(isFilled, "must not be blank");

/** One worker proof: the test that failed before the code, and how. Four non-blank strings. */
export const ProofSchema = z.object({ part: filled, file: filled, test: filled, failure: filled });

export type StatsProof = z.infer<typeof ProofSchema>;

export const isProof = (item: unknown): item is StatsProof => ProofSchema.safeParse(item).success;

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
