import { partIdOf } from "../../domain/part.ts";
import { partsDir } from "../../domain/task.ts";
import { files } from "../infra/files.ts";

/** Parts: the part files in `<dir>/parts/`, one per piece of the plan. */
export const parts = { read };

/** The part ids, `01`, in file name order. */
async function read(dir: string): Promise<string[]> {
  const names = await files.list(partsDir(dir));
  return names
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map(partIdOf);
}
