import path from "node:path";
import { countParts, type PartCounts, partIdOf, readPartStatus } from "../../domain/parts.ts";
import { partsDir } from "../../domain/taskDirs.ts";
import { files } from "../infra/files.ts";

/** Parts: the part files in `<dir>/parts/`, one per piece of the plan. */
export const parts = { read, get };

/** The part ids, `01`, in file name order. */
async function read(dir: string): Promise<string[]> {
  const names = await files.list(partsDir(dir));
  return names
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map(partIdOf);
}

/** How many parts have each status, from the `status:` line of each part file. */
async function get(dir: string): Promise<PartCounts> {
  const names = await files.list(partsDir(dir));
  const texts = await Promise.all(
    names.filter((n) => n.endsWith(".md")).map((n) => files.read(path.join(partsDir(dir), n))),
  );
  return countParts(texts.filter((text) => text !== null).map(readPartStatus));
}
