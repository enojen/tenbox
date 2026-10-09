import os from "node:os";
import { noSessionError } from "../../domain/errors/tasks.ts";
import { type ProjectId, type TaskId, tmuxSessionName } from "../../domain/ids.ts";
import type { Names } from "../../domain/manifest.ts";
import { tmuxDir } from "../../domain/project.ts";
import { claudeCommand, findClaude } from "../infra/claude.ts";
import { log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { processes } from "../infra/processes.ts";
import { attachCommand, type TmuxTarget, tmux } from "../infra/tmux.ts";

type TmuxState = "started" | "exists" | "skipped" | "unavailable";

export type SessionRemoveState = "killed" | "skipped";

export interface TmuxInfo {
  session: string;
  server: string;
  state: TmuxState;
  attach: string;
}

/** What `claude` starts with in the task's session. */
interface SessionStart {
  id: TaskId;
  target: TmuxTarget;
  taskWorktree: string;
  taskDir: string;
  model: string;
}

/** The task's tmux session, on the task's own tmux server, with `claude` in it. */
export const sessions = { tmuxTarget, ensure, send, remove };

/** The task's session on the task's own tmux server. */
function tmuxTarget(names: Names, projectId: ProjectId, id: TaskId): TmuxTarget {
  return { server: tmuxDir(os.tmpdir(), projectId, id), session: tmuxSessionName(names, id) };
}

/** Starts the session with `claude` running `/tenbox-plan <id>`; null `start` means not asked for. */
async function ensure(target: TmuxTarget, start: SessionStart | null): Promise<TmuxInfo> {
  const info = { ...target, attach: attachCommand(target) };
  if (start === null) return { ...info, state: "skipped" };
  const state = await startSession(start);
  return { ...info, state };
}

async function startSession(start: SessionStart): Promise<TmuxState> {
  const { target } = start;
  const exists = await tmux.hasSession(target);
  if (exists) return logTmux(`session ${target.session} exists`, "exists");
  const claude = findClaude();
  if (claude === null) {
    return logTmux("claude not found in PATH, session not started", "unavailable");
  }
  await files.mkdir(target.server);
  const command = claudeCommand(claude, {
    model: start.model,
    addDir: start.taskDir,
    prompt: `/tenbox-plan ${start.id}`,
  });
  await tmux.newSession(target, start.taskWorktree, command);
  return logTmux(`session ${target.session} started`, "started");
}

/** Types `text` as one line into the task's `claude`; `no-session` without a session. */
async function send(id: TaskId, target: TmuxTarget, text: string): Promise<void> {
  if (processes.which("tmux") === null) throw noSessionError(id);
  const exists = await tmux.hasSession(target);
  if (!exists) throw noSessionError(id);
  await tmux.typeLine(target, text);
}

/** Kills the task's tmux server; nothing to do without `tmux` or without a running server. */
async function remove(server: string): Promise<SessionRemoveState> {
  if (processes.which("tmux") === null) return "skipped";
  const running = await tmux.isRunning(server);
  if (!running) return "skipped";
  await tmux.killServer(server);
  return "killed";
}

function logTmux(message: string, state: TmuxState): TmuxState {
  log(`tenbox start: tmux ${message}`);
  return state;
}
