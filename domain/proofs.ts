import { z } from "zod";
import { badFileError } from "./errors/index.ts";
import { jsons, strings } from "./utils.ts";

const filled = z.string().refine(strings.isNotBlank, "must not be blank");

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

/** The proofs in the text of `proofs.json`; `bad-file` unless it is an array of valid proofs. */
export function readProofs(text: string, file: string): StatsProof[] {
  const result = jsons.check(z.array(ProofSchema), text);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}

const sameProof = (a: StatsProof, b: StatsProof): boolean =>
  a.part === b.part && a.file === b.file && a.test === b.test && a.failure === b.failure;

/** `recorded`, then each added proof with a part, file, test and failure not seen yet. */
export function withNewProofs(recorded: StatsProof[], added: StatsProof[]): StatsProof[] {
  const all = [...recorded];
  for (const proof of added) {
    if (!all.some((seen) => sameProof(seen, proof))) all.push(proof);
  }
  return all;
}
