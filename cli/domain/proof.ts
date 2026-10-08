import { isFilled, isPlainObject } from "./utils.ts";

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
