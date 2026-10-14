import { noSessionError } from "../../domain/errors/tasks.ts";
import { noCommandError } from "../../domain/errors/tools.ts";
import type { TaskId } from "../../domain/ids.ts";
import {
  type BackgroundSession,
  type ClaudeRun,
  type ClaudeStart,
  claude,
} from "../infra/claude/background.ts";
import { log } from "../infra/env.ts";
import { files } from "../infra/files.ts";

type SessionStartState = "started" | "exists" | "skipped" | "unavailable";

export type SessionStopState = "stopped" | "skipped";

export interface SessionStartInfo {
  /** The `-n` name of the session. */
  session: string;
  state: SessionStartState;
}

/** A background `claude` session in one task worktree. */
interface SessionTarget {
  id: TaskId;
  taskWorktree: string;
}

interface SessionEnsureInput {
  target: SessionTarget;
  start: ClaudeStart;
  /** False with `--no-claude`. */
  enabled: boolean;
}

/** The task's background `claude` sessions, all started in its task worktree. */
export const sessions = { ensure, run, attach, stop };

/** `tenbox start`: starts the plan unless a session of the task worktree is listed. */
async function ensure(input: SessionEnsureInput): Promise<SessionStartInfo> {
  const { target, start, enabled } = input;
  const session = start.name;
  if (!enabled) return { session, state: "skipped" };
  const claudeRun = await openRun(target);
  if (claudeRun === null) return logStart(session, "unavailable", "claude not found in PATH");
  const existing = await claude.listBackground(claudeRun);
  if (existing.length > 0) return logStart(session, "exists", "a background session exists");
  await claude.startBackground(claudeRun, start);
  return logStart(session, "started", `session ${session} started`);
}

/** `tenbox build`: starts a new session; claude's own message when it refuses. */
async function run(target: SessionTarget, start: ClaudeStart): Promise<void> {
  const claudeRun = await requireRun(target);
  await claude.startBackground(claudeRun, start);
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
  if (!exists) return "skipped";
  const claudeRun = await openRun(target);
  if (claudeRun === null) return "skipped";
  const found = await claude.listBackground(claudeRun);
  for (const session of found) await claude.stop(claudeRun, session.id);
  return found.length > 0 ? "stopped" : "skipped";
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
