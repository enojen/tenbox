import { failedState } from "../../domain/errors/index.ts";
import { noSessionError, sessionBusyError } from "../../domain/errors/tasks.ts";
import { claudeError, noCommandError } from "../../domain/errors/tools.ts";
import type { TaskId } from "../../domain/ids.ts";
import { durations } from "../../domain/utils.ts";
import {
  type BackgroundSession,
  type ClaudeResume,
  type ClaudeRun,
  type ClaudeStart,
  claude,
} from "../infra/claude/background.ts";
import { env, log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { pollUntil } from "../infra/poll.ts";
import { processes } from "../infra/processes.ts";

const STOP_WAIT_SECONDS = 10;
const STOP_WAIT_MS = STOP_WAIT_SECONDS * durations.MS_PER_SECOND;
const STOP_POLL_MS = 200;

const SESSION_START_STATE = {
  started: "started",
  exists: "exists",
  skipped: "skipped",
  unavailable: "unavailable",
} as const;

type SessionStartState = (typeof SESSION_START_STATE)[keyof typeof SESSION_START_STATE];

const SESSION_STOP_STATE = { stopped: "stopped", skipped: "skipped" } as const;

export type SessionStopState = (typeof SESSION_STOP_STATE)[keyof typeof SESSION_STOP_STATE];

export interface SessionStartInfo {
  /** The `-n` name of the session. */
  session: string;
  state: SessionStartState;
}

/** A background `claude` session in one task worktree. */
export interface SessionTarget {
  id: TaskId;
  taskWorktree: string;
}

/** A task worktree and the `state` of its newest background session. */
export interface TargetState extends SessionTarget {
  state: string;
}

interface SessionEnsureInput {
  target: SessionTarget;
  start: ClaudeStart;
  /** False with `--no-claude`. */
  enabled: boolean;
}

/** The task's background `claude` sessions, all started in its task worktree. */
export const sessions = { ensure, run, resume, attach, stop, findCurrent, findState, findStates };

/** `tenbox start`: starts the plan unless a session of the task worktree is listed. */
async function ensure(input: SessionEnsureInput): Promise<SessionStartInfo> {
  const { target, start, enabled } = input;
  const session = start.name;
  if (!enabled) return { session, state: SESSION_START_STATE.skipped };
  const claudeRun = await openRun(target);
  if (claudeRun === null) {
    return logStart(session, SESSION_START_STATE.unavailable, "claude not found in PATH");
  }
  const existing = await claude.listBackground(claudeRun);
  if (existing.length > 0) {
    return logStart(session, SESSION_START_STATE.exists, "a background session exists");
  }
  await claude.startBackground(claudeRun, start);
  return logStart(session, SESSION_START_STATE.started, `session ${session} started`);
}

/** `tenbox build`: starts a new session unless one is busy; claude's own message when it refuses. */
async function run(target: SessionTarget, start: ClaudeStart): Promise<void> {
  const claudeRun = await requireRun(target);
  const found = await claude.listBackground(claudeRun);
  if (found.some((session) => session.busy)) throw sessionBusyError(target.id);
  await claude.startBackground(claudeRun, start);
}

/**
 * `tenbox answer`: stops the task's sessions, then wakes the one that ran the workflow. `claude
 * stop` returns before the session ends, and a resume before then starts a copy under a new id,
 * which cannot find the run's journal; so it waits until their processes have ended.
 */
async function resume(target: SessionTarget, resumed: ClaudeResume): Promise<void> {
  const claudeRun = await requireRun(target);
  const stopped = await stopAll(claudeRun);
  await waitEnded(stopped);
  await claude.resumeBackground(claudeRun, resumed);
}

/** Opens the newest session in this terminal and returns its id; `no-session` without one. */
async function attach(target: SessionTarget): Promise<string> {
  const claudeRun = await requireRun(target);
  const found = await claude.listBackground(claudeRun);
  const newest = [...found].sort(byStart).at(-1);
  if (newest === undefined) throw noSessionError(target.id);
  await claude.attach(claudeRun, newest.id);
  return newest.id;
}

/** `tenbox close`: stops every session of the task worktree; the transcripts stay. */
async function stop(target: SessionTarget): Promise<SessionStopState> {
  const exists = await files.isDir(target.taskWorktree);
  if (!exists) return SESSION_STOP_STATE.skipped;
  const claudeRun = await openRun(target);
  if (claudeRun === null) return SESSION_STOP_STATE.skipped;
  const stopped = await stopAll(claudeRun);
  return stopped.length > 0 ? SESSION_STOP_STATE.stopped : SESSION_STOP_STATE.skipped;
}

/** Returns the sessions it stopped. */
async function stopAll(claudeRun: ClaudeRun): Promise<BackgroundSession[]> {
  const found = await claude.listBackground(claudeRun);
  for (const session of found) await claude.stop(claudeRun, session.id);
  return found;
}

async function waitEnded(stopped: BackgroundSession[]): Promise<void> {
  const running = () => stopped.filter((session) => processes.isRunning(session.pid));
  const check = async () => (running().length > 0 ? null : true);
  const deadlineMs = Date.now() + STOP_WAIT_MS;
  const ended = await pollUntil({ check, deadlineMs, intervalMs: STOP_POLL_MS });
  if (ended !== null) return;
  const ids = running().map((session) => session.id);
  throw claudeError("stop", `${ids.join(", ")} still running after ${STOP_WAIT_SECONDS} s`);
}

/** The background session of the task worktree that runs this command; null outside one. */
async function findCurrent(target: SessionTarget): Promise<BackgroundSession | null> {
  const current = env().claudeSession;
  if (current === null) return null;
  const claudeRun = await openRun(target);
  if (claudeRun === null) return null;
  const found = await claude.listBackground(claudeRun);
  return found.find((session) => session.sessionId === current) ?? null;
}

/** The `claude` binary in the task worktree, whose real path Claude Code records; null without `claude`. */
async function openRun(target: SessionTarget): Promise<ClaudeRun | null> {
  const binary = claude.find();
  if (binary === null) return null;
  const cwd = await files.realPath(target.taskWorktree);
  return { claude: binary, cwd };
}

async function requireRun(target: SessionTarget): Promise<ClaudeRun> {
  const claudeRun = await openRun(target);
  if (claudeRun === null) throw noCommandError("claude");
  return claudeRun;
}

function byStart(a: BackgroundSession, b: BackgroundSession): number {
  return a.startedAt - b.startedAt;
}

function logStart(session: string, state: SessionStartState, message: string): SessionStartInfo {
  log(`tenbox start: claude ${message}`);
  return { session, state };
}

/** What `tenbox status` shows when `claude` is missing, or the task has no background session. */
const SESSION_STATE = { unavailable: "unavailable", none: "none" } as const;

/** The `state` of the newest background session; `unavailable` without `claude`, `failed: <reason>` when it fails. */
async function findState(target: SessionTarget): Promise<string> {
  const claudeRun = await openRun(target);
  if (claudeRun === null) return SESSION_STATE.unavailable;
  try {
    const found = await claude.listBackground(claudeRun);
    return newestState(found);
  } catch (e) {
    return failedState(e);
  }
}

/** Task worktrees under `dir`, whose sessions one `claude agents --cwd <dir>` lists. */
interface StatesQuery {
  dir: string;
  targets: SessionTarget[];
}

/**
 * Each target with the `state` of its newest background session; `unavailable` without
 * `claude`, `failed: <reason>` when it fails.
 */
async function findStates(query: StatesQuery): Promise<TargetState[]> {
  const { dir, targets } = query;
  const binary = claude.find();
  if (binary === null)
    return targets.map((target) => ({ ...target, state: SESSION_STATE.unavailable }));
  try {
    const cwd = await files.realPath(dir);
    const found = await claude.listUnder({ claude: binary, cwd });
    return await Promise.all(targets.map((target) => withNewestState({ target, found })));
  } catch (e) {
    const state = failedState(e);
    return targets.map((target) => ({ ...target, state }));
  }
}

interface FoundSessions {
  target: SessionTarget;
  found: BackgroundSession[];
}

async function withNewestState(input: FoundSessions): Promise<TargetState> {
  const { target, found } = input;
  const real = await files.realPath(target.taskWorktree);
  const own = found.filter((session) => session.cwd === real);
  return { ...target, state: newestState(own) };
}

function newestState(found: BackgroundSession[]): string {
  return [...found].sort(byStart).at(-1)?.state ?? SESSION_STATE.none;
}
