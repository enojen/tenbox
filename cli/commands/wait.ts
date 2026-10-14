import { buildFile, ROUND_RUNNING, readBuild } from "../../domain/build.ts";
import { waitTimeoutError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { planFile } from "../../domain/plan.ts";
import { checksFile, roundDir, roundNumbers, roundsDir, tenboxDir } from "../../domain/task.ts";
import { MS_PER_SECOND } from "../../domain/utils.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { files } from "../infra/files.ts";
import { pollUntil } from "../infra/poll.ts";
import type { TaskFileResult, WaitRoundResult } from "./results.ts";

type WaitFileKind = "plan" | "build";
export type WaitKind = WaitFileKind | "round";

export interface WaitInput {
  id: TaskId;
  kind: WaitKind;
  timeoutSeconds: number;
}

/** True for the three things `tenbox wait` can wait for. */
export const isWaitKind = (value: string | undefined): value is WaitKind =>
  value === "plan" || value === "build" || value === "round";

const FILE_OF: Record<WaitFileKind, (dir: string) => string> = {
  plan: planFile,
  build: buildFile,
};

/** What `tenbox wait` waits for: a name for the timeout message and a check that is null until done. */
interface TimedPoll<T> {
  what: string;
  timeoutSeconds: number;
  check: () => Promise<T | null>;
}

/** Checks once a second until `check` returns a value; `wait-timeout` after the timeout. */
async function pollOrTimeout<T>(poll: TimedPoll<T>): Promise<T> {
  const { what, timeoutSeconds, check } = poll;
  const deadlineMs = Date.now() + timeoutSeconds * MS_PER_SECOND;
  const found = await pollUntil({ check, deadlineMs });
  if (found === null) throw waitTimeoutError(what, timeoutSeconds);
  return found;
}

/** `plan.json` or `build.json` of the task exists, or the next round change. */
export function waitFor(input: WaitInput): Promise<TaskFileResult | WaitRoundResult> {
  if (input.kind === "round") return waitForRound(input);
  return waitForFile({ ...input, kind: input.kind });
}

async function waitForFile(input: WaitInput & { kind: WaitFileKind }): Promise<TaskFileResult> {
  const { id, kind, timeoutSeconds } = input;
  const taskWorktree = await worktrees.get(id);
  const file = FILE_OF[kind](tenboxDir(taskWorktree));
  const check = async (): Promise<TaskFileResult | null> => {
    const exists = await files.exists(file);
    return exists ? { ok: true, task: id, file } : null;
  };
  return pollOrTimeout({ what: file, timeoutSeconds, check });
}

/** The moment this process started: a file written after it counts as a change of the wait. */
const processStartMs = (): number => Date.now() - process.uptime() * MS_PER_SECOND;

/**
 * Returns at the first change after the process started: a `rounds/N/checks.json` (status
 * `running`) or a `build.json` that is written or changed (its status). A file's modification
 * time is the proof, so a write that lands before the first look is not missed.
 */
async function waitForRound(input: WaitInput): Promise<WaitRoundResult> {
  const { id, timeoutSeconds } = input;
  const since = processStartMs();
  const taskWorktree = await worktrees.get(id);
  const dir = tenboxDir(taskWorktree);
  const check = () => findChange({ id, dir, since });
  return pollOrTimeout({ what: roundsDir(dir), timeoutSeconds, check });
}

/** The file exists and was modified at or after `since`. */
async function changedSince(file: string, since: number): Promise<boolean> {
  const exists = await files.exists(file);
  if (!exists) return false;
  const mtime = await files.mtime(file);
  return mtime >= since;
}

interface RoundChangeInput {
  id: TaskId;
  dir: string;
  since: number;
}

async function findChange(input: RoundChangeInput): Promise<WaitRoundResult | null> {
  const { id, dir, since } = input;
  const buildChanged = await changedSince(buildFile(dir), since);
  const text = await files.read(buildFile(dir));
  const build = buildChanged && text !== null ? readBuild(text) : null;
  if (build !== null) {
    return { ok: true, task: id, round: build.round, status: build.status, file: buildFile(dir) };
  }
  const names = await files.list(roundsDir(dir));
  for (const round of roundNumbers(names).reverse()) {
    const file = checksFile(roundDir(dir, round));
    const changed = await changedSince(file, since);
    if (changed) return { ok: true, task: id, round, status: ROUND_RUNNING, file };
  }
  return null;
}
