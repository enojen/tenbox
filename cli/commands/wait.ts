import {
  BUILD_STATUS,
  buildFile,
  type DecisionCard,
  ROUND_RUNNING,
  readBuild,
} from "../../domain/build.ts";
import { waitTimeoutError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { planFile } from "../../domain/plan.ts";
import { checksFile, roundDir, roundNumbers, roundsDir, tenboxDir } from "../../domain/task.ts";
import { durations } from "../../domain/utils.ts";
import { builds } from "../application/builds.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { files } from "../infra/files.ts";
import { pollUntil } from "../infra/poll.ts";
import type { TaskFileResult, WaitEventResult, WaitRoundResult } from "./results.ts";

/** The things `tenbox wait` can wait for. */
const WAIT_KIND = {
  plan: "plan",
  build: "build",
  round: "round",
  decision: "decision",
  any: "any",
} as const;

type WaitFileKind = typeof WAIT_KIND.plan | typeof WAIT_KIND.build;
export type WaitKind = (typeof WAIT_KIND)[keyof typeof WAIT_KIND];

const WAIT_KINDS: string[] = Object.values(WAIT_KIND);

/** What ended a `--for decision` or `--for any` wait. */
const WAIT_EVENT = { decision: "decision", build: "build", plan: "plan" } as const;

export type WaitEvent = (typeof WAIT_EVENT)[keyof typeof WAIT_EVENT];

export interface WaitInput {
  id: TaskId;
  kind: WaitKind;
  timeoutSeconds: number;
}

/** True for the things `tenbox wait` can wait for. */
export const isWaitKind = (value: string | undefined): value is WaitKind =>
  value !== undefined && WAIT_KINDS.includes(value);

const FILE_OF: Record<WaitFileKind, (dir: string) => string> = {
  [WAIT_KIND.plan]: planFile,
  [WAIT_KIND.build]: buildFile,
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
  const deadlineMs = Date.now() + timeoutSeconds * durations.MS_PER_SECOND;
  const found = await pollUntil({ check, deadlineMs });
  if (found === null) throw waitTimeoutError(what, timeoutSeconds);
  return found;
}

/** `plan.json` or `build.json` of the task exists, the next round changes, or a decision waits. */
export function waitFor(
  input: WaitInput,
): Promise<TaskFileResult | WaitRoundResult | WaitEventResult> {
  if (input.kind === WAIT_KIND.round) return waitForRound(input);
  if (input.kind === WAIT_KIND.decision) return waitForDecision(input);
  if (input.kind === WAIT_KIND.any) return waitForAny(input);
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
const processStartMs = (): number => Date.now() - process.uptime() * durations.MS_PER_SECOND;

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
  const file = buildFile(dir);
  const buildChanged = await changedSince(file, since);
  const text = await files.read(file);
  const build = buildChanged && text !== null ? readBuild(text, file) : null;
  if (build !== null) {
    return { ok: true, task: id, round: build.round, status: build.status, file };
  }
  const names = await files.list(roundsDir(dir));
  for (const round of roundNumbers(names).reverse()) {
    const file = checksFile(roundDir(dir, round));
    const changed = await changedSince(file, since);
    if (changed) return { ok: true, task: id, round, status: ROUND_RUNNING, file };
  }
  return null;
}

/** The unanswered card of a `needs-you` `build.json`; null when there is none. */
async function findOpenDecision(dir: string): Promise<DecisionCard | null> {
  const build = await builds.find(dir);
  if (build?.status !== BUILD_STATUS.needsYou || build.answered !== undefined) return null;
  return build.decision ?? null;
}

/** Returns when `build.json` holds a `needs-you` card that no one has answered yet. */
async function waitForDecision(input: WaitInput): Promise<WaitEventResult> {
  const { id, timeoutSeconds } = input;
  const taskWorktree = await worktrees.get(id);
  const dir = tenboxDir(taskWorktree);
  const check = async (): Promise<WaitEventResult | null> => {
    const decision = await findOpenDecision(dir);
    if (decision === null) return null;
    return { ok: true, task: id, event: WAIT_EVENT.decision, file: buildFile(dir), decision };
  };
  return pollOrTimeout({ what: buildFile(dir), timeoutSeconds, check });
}

interface AnyInput {
  id: TaskId;
  dir: string;
  since: number;
}

/** One thing that can end `--for any`: its event, its file and whether it happened. */
interface Candidate {
  event: WaitEvent;
  file: string;
  happened: boolean;
}

/**
 * Returns at the first of: an unanswered decision, a `build.json` written after the process
 * started, a `plan.json` written after it started. A file's modification time is the proof,
 * as for `--for round`, so a `plan.json` of an earlier phase does not end the wait.
 */
async function waitForAny(input: WaitInput): Promise<WaitEventResult> {
  const { id, timeoutSeconds } = input;
  const since = processStartMs();
  const taskWorktree = await worktrees.get(id);
  const dir = tenboxDir(taskWorktree);
  const check = () => findEvent({ id, dir, since });
  return pollOrTimeout({ what: dir, timeoutSeconds, check });
}

async function findEvent(input: AnyInput): Promise<WaitEventResult | null> {
  const { id, dir, since } = input;
  const decision = await findOpenDecision(dir);
  const buildChanged = await changedSince(buildFile(dir), since);
  const planChanged = await changedSince(planFile(dir), since);
  const candidates: Candidate[] = [
    { event: WAIT_EVENT.decision, file: buildFile(dir), happened: decision !== null },
    { event: WAIT_EVENT.build, file: buildFile(dir), happened: buildChanged },
    { event: WAIT_EVENT.plan, file: planFile(dir), happened: planChanged },
  ];
  const first = candidates.find((candidate) => candidate.happened);
  if (first === undefined) return null;
  return { ok: true, task: id, event: first.event, file: first.file, decision };
}
