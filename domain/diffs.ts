/* A diff: the files a branch changed against its base, from `git diff --numstat`. */

/** One file of a diff; a binary file counts 0 lines. */
export interface DiffFile {
  added: number;
  removed: number;
  path: string;
}

/** The lines a diff changed: added plus removed, over every file. */
export const diffLines = (files: DiffFile[]): number =>
  files.reduce((sum, file) => sum + file.added + file.removed, 0);

/** The files of several diffs with each path once, at its largest change. */
export function mergeDiffs(diffs: DiffFile[][]): DiffFile[] {
  const byPath = new Map<string, DiffFile>();
  for (const file of diffs.flat()) {
    const known = byPath.get(file.path);
    if (known === undefined || diffLines([file]) > diffLines([known])) byPath.set(file.path, file);
  }
  return [...byPath.values()];
}
