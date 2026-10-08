const PART_ID = /^[^-.]+/;

export interface PartFile {
  id: string;
  text: string;
}

/** The `NN` of a part file name `NN-<slug>.md`. */
export function partIdOf(fileName: string): string {
  return PART_ID.exec(fileName)?.[0] ?? fileName;
}
