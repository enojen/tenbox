import path from "node:path";
import { type Baseline, type FailureLine, failureLine } from "../domain/failures.ts";
import { env } from "./env.ts";
import { files } from "./files.ts";

/** One baseline directory: `<baselinesRoot>/<project>/<check>/`. */
export interface BaselineKey {
  project: string;
  check: string;
}

export interface BaselineMeta {
  date: string;
  cmd: string;
  exit_code: number;
}

interface SavedFile {
  name: string;
  mtime: number;
}

const TEXT_EXT = ".txt";
const META_EXT = ".meta";

/** Baselines on disk, one directory per project and check. */
export const baselineStore = { find, findNewest, save };

/** The baseline taken at `sha`, or null. */
async function find(key: BaselineKey, sha: string): Promise<Baseline | null> {
  const text = await files.read(baselineFile(key, sha, TEXT_EXT));
  return text === null ? null : { sha, lines: parseLines(text) };
}

/** The most recently saved baseline for the check, or null. */
async function findNewest(key: BaselineKey): Promise<Baseline | null> {
  const dir = keyDir(key);
  const all = await files.list(dir);
  const names = all.filter((name) => name.endsWith(TEXT_EXT));
  const saved: SavedFile[] = await Promise.all(
    names.map(async (name) => ({ name, mtime: await files.mtime(path.join(dir, name)) })),
  );
  const latest = saved.sort((a, b) => b.mtime - a.mtime)[0];
  return latest ? find(key, path.basename(latest.name, TEXT_EXT)) : null;
}

/** `<sha>.txt` plus `<sha>.meta`: the devbox `wtbase` layout. */
async function save(key: BaselineKey, baseline: Baseline, meta: BaselineMeta): Promise<void> {
  await files.write(baselineFile(key, baseline.sha, TEXT_EXT), renderLines(baseline.lines));
  await files.write(baselineFile(key, baseline.sha, META_EXT), renderMeta(baseline.sha, meta));
}

function keyDir(key: BaselineKey): string {
  return path.join(env().baselinesRoot, key.project, key.check);
}

function baselineFile(key: BaselineKey, sha: string, ext: string): string {
  return path.join(keyDir(key), `${sha}${ext}`);
}

function renderLines(lines: FailureLine[]): string {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function parseLines(text: string): FailureLine[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map(failureLine);
}

function renderMeta(sha: string, meta: BaselineMeta): string {
  return `sha=${sha}\ndate=${meta.date}\ncmd=${meta.cmd}\nexit_code=${meta.exit_code}\n`;
}
