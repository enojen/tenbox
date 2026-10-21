/** One file of a diff; a binary file counts 0 lines. */
export interface ChangedFile {
  added: number;
  removed: number;
  path: string;
}

/** The lines a diff changed: added plus removed, over every file. */
export const changedLines = (files: ChangedFile[]): number =>
  files.reduce((sum, file) => sum + file.added + file.removed, 0);
