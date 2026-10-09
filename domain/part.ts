const PART_ID = /^[^-.]+/;

/** The `NN` of a part name `NN-<slug>` or a part file name `NN-<slug>.md`. */
export function partIdOf(fileName: string): string {
  return PART_ID.exec(fileName)?.[0] ?? fileName;
}
