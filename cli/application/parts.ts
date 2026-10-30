import path from "node:path";
import {
  countParts,
  PART_STATUS,
  type PartCounts,
  type PartStatus,
  partIdOf,
  readPartStatus,
} from "../../domain/parts.ts";
import { partsDir } from "../../domain/taskDirs.ts";
import { files } from "../infra/files.ts";

/** Parts: the part files in `<dir>/parts/`, one per piece of the plan. */
export const parts = { read, readDone, get };

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
  const statuses = await readStatuses(dir);
  return countParts(statuses.map((part) => part.status));
}

async function readDone(dir: string): Promise<string[]> {
  const statuses = await readStatuses(dir);
  return statuses.filter((part) => part.status === PART_STATUS.done).map((part) => part.id);
}

interface PartState {
  id: string;
  status: PartStatus;
}

async function readStatuses(dir: string): Promise<PartState[]> {
  const names = await files.list(partsDir(dir));
  const states: PartState[] = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const text = await files.read(path.join(partsDir(dir), name));
    if (text !== null) states.push({ id: partIdOf(name), status: readPartStatus(text) });
  }
  return states;
}
