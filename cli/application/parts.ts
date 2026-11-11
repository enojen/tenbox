import path from "node:path";
import { unknownPartError } from "../../domain/errors/plans.ts";
import {
  countParts,
  findStaleParts,
  PART_STATUS,
  type PartCounts,
  type PartFile,
  type PartStatus,
  partIdOf,
  readPartFiles,
  readPartResult,
  readPartStatus,
  reopenPart,
  type StalePart,
} from "../../domain/parts.ts";
import type { PlanPart } from "../../domain/plans.ts";
import type { ReportPart } from "../../domain/statusReports.ts";
import { partsDir } from "../../domain/taskDirs.ts";
import { files } from "../infra/files.ts";

/** Parts: the part files in `<dir>/parts/`, one per piece of the plan. */
export const parts = { read, readDone, readNotDone, get, reopen, findStale };

/** The part ids, `01`, in file name order. */
async function read(dir: string): Promise<string[]> {
  const names = await listPartFiles(dir);
  return names.map(partIdOf);
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
  const names = await listPartFiles(dir);
  const states: PartState[] = [];
  for (const name of names) {
    const text = await files.read(path.join(partsDir(dir), name));
    if (text === null) continue;
    states.push({ id: partIdOf(name), status: readPartStatus(text), result: readPartResult(text) });
  }
  return states;
}

interface PartReopenRequest {
  dir: string;
  part: string;
  accept: string;
}

/** Rewrites the part file as reopened and returns its path; `unknown-part` without one. */
async function reopen(request: PartReopenRequest): Promise<string> {
  const { dir, part, accept } = request;
  const names = await listPartFiles(dir);
  const name = names.find((candidate) => partIdOf(candidate) === part);
  if (name === undefined) throw unknownPartError(part);
  const file = path.join(partsDir(dir), name);
  const text = await files.read(file);
  if (text === null) throw unknownPartError(part);
  await files.write(file, reopenPart({ text, accept }));
  return file;
}

async function findStale(dir: string, planParts: PlanPart[]): Promise<StalePart[]> {
  const names = await listPartFiles(dir);
  const partFiles: PartFile[] = [];
  for (const name of names) {
    const text = await files.read(path.join(partsDir(dir), name));
    if (text === null) continue;
    partFiles.push({ part: partIdOf(name), file: name, files: readPartFiles(text) });
  }
  return findStaleParts({ planParts, partFiles });
}

async function listPartFiles(dir: string): Promise<string[]> {
  const names = await files.list(partsDir(dir));
  return names.filter((n) => n.endsWith(".md")).sort();
}
