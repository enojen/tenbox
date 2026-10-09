import { tmuxError } from "../../domain/errors/tools.ts";
import { type ProcessResult, processes } from "./processes.ts";

/** One task's tmux server: the `TMUX_TMPDIR` dir that holds its socket. */
export type TmuxServer = string;

/** A session on one tmux server. */
export interface TmuxTarget {
  server: TmuxServer;
  session: string;
}

/** Every call reaches only the given server: `TMUX` would win over `TMUX_TMPDIR`, so it is empty. */
export const tmux = {
  async hasSession(target: TmuxTarget): Promise<boolean> {
    const result = await runOn(target.server, ["has-session", "-t", `=${target.session}`]);
    return result.code === 0;
  },

  async isRunning(server: TmuxServer): Promise<boolean> {
    const result = await runOn(server, ["list-sessions"]);
    return result.code === 0;
  },

  newSession(target: TmuxTarget, cwd: string, command: string[]): Promise<void> {
    return run(target.server, ["new-session", "-d", "-s", target.session, "-c", cwd, ...command]);
  },

  /** Clears the input line (`C-e`, `C-u`), types `text` as it is and presses Enter. */
  async typeLine(target: TmuxTarget, text: string): Promise<void> {
    await sendKeys(target, ["C-e", "C-u"]);
    await run(target.server, ["send-keys", "-t", paneOf(target), "-l", text]);
    await sendKeys(target, ["Enter"]);
  },

  killServer(server: TmuxServer): Promise<void> {
    return run(server, ["kill-server"]);
  },
};

/** The `TMUX_TMPDIR` and `TMUX` values of an attach command for the user's shell. */
export function attachCommand(target: TmuxTarget): string {
  return `TMUX= TMUX_TMPDIR=${target.server} tmux attach -t ${target.session}`;
}

/** Key names such as `C-u` or `Enter`. */
function sendKeys(target: TmuxTarget, keys: string[]): Promise<void> {
  return run(target.server, ["send-keys", "-t", paneOf(target), ...keys]);
}

/** The active pane of the session, by exact session name. */
function paneOf(target: TmuxTarget): string {
  return `=${target.session}:`;
}

function runOn(server: TmuxServer, args: string[]): Promise<ProcessResult> {
  return processes.run(["tmux", ...args], { env: { TMUX_TMPDIR: server, TMUX: "" } });
}

/** Throws with tmux's stderr on a non-zero exit. */
async function run(server: TmuxServer, args: string[]): Promise<void> {
  const result = await runOn(server, args);
  if (result.code === 0) return;
  const reason = result.stderr.trim();
  throw tmuxError(args[0], reason);
}
