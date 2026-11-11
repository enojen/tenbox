import path from "node:path";
import {
  countParts,
  PART_STATUS,
  type PartCounts,
  type PartStatus,
  partIdOf,
  readPartResult,
  readPartStatus,
} from "../../domain/parts.ts";
import type { ReportPart } from "../../domain/statusReports.ts";
import { partsDir } from "../../domain/taskDirs.ts";
import { files } from "../infra/files.ts";

/** Parts: the part files in `<dir>/parts/`, one per piece of the plan. */
export const parts = { read, readDone, readNotDone, get };

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

/** The parts whose status is not `done`, with their `result:` line. */
async function readNotDone(dir: string): Promise<ReportPart[]> {
  const states = await readStatuses(dir);
  return states
    .filter((state) => state.status !== PART_STATUS.done)
    .map((state) => ({ part: state.id, status: state.status, result: state.result }));
}

interface PartState {
  id: string;
  status: PartStatus;
  result: string | null;
}

async function readStatuses(dir: string): Promise<PartState[]> {
  const names = await files.list(partsDir(dir));
  const states: PartState[] = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const text = await files.read(path.join(partsDir(dir), name));
    if (text === null) continue;
    states.push({ id: partIdOf(name), status: readPartStatus(text), result: readPartResult(text) });
  }
  return states;
}
