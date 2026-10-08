import { log } from "../infra/env.ts";
import { processes } from "../infra/processes.ts";
import { tmux } from "../infra/tmux.ts";

export type TmuxState = "started" | "exists" | "skipped" | "unavailable";

export type SessionRemoveState = "killed" | "skipped";

export interface TmuxInfo {
  session: string;
  state: TmuxState;
  attach: string;
}

/** The tmux session of a task, with `claude` in it. */
export const sessions = { ensure, remove };

/** Starts the task's tmux session with `claude` in it; null `taskWorktree` means not asked for. */
async function ensure(session: string, taskWorktree: string | null): Promise<TmuxInfo> {
  const attach = `tmux attach -t ${session}`;
  if (taskWorktree === null) return { session, state: "skipped", attach };
  const state = await startSession(session, taskWorktree);
  return { session, state, attach };
}

async function startSession(session: string, taskWorktree: string): Promise<TmuxState> {
  const exists = await tmux.hasSession(session);
  if (exists) return logTmux(`session ${session} exists`, "exists");
  const claude = processes.which("claude");
  if (claude === null) {
    return logTmux("claude not found in PATH, session not started", "unavailable");
  }
  await tmux.newSession(session, taskWorktree, [claude]);
  return logTmux(`session ${session} started`, "started");
}

/** Kills the session; nothing to do without `tmux` or without the session. */
async function remove(session: string): Promise<SessionRemoveState> {
  if (processes.which("tmux") === null) return "skipped";
  const exists = await tmux.hasSession(session);
  if (!exists) return "skipped";
  await tmux.killSession(session);
  return "killed";
}

function logTmux(message: string, state: TmuxState): TmuxState {
  log(`tenbox start: tmux ${message}`);
  return state;
}
