import path from "node:path";
import { type PartFile, partIdOf } from "../domain/part.ts";
import { files } from "../infra/files.ts";

/** Parts: the part files in `<dir>/parts/`, one per piece of the plan. */
export const parts = { read };

/** The part files in name order. */
async function read(dir: string): Promise<PartFile[]> {
  const partsDir = path.join(dir, "parts");
  const names = await files.list(partsDir);
  const partFiles: PartFile[] = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const text = await files.read(path.join(partsDir, name));
    partFiles.push({ id: partIdOf(name), text: text ?? "" });
  }
  return partFiles;
}
