import { TenboxError } from "../../domain/errors/index.ts";
import { processes } from "./processes.ts";

export const tmux = {
  async hasSession(name: string): Promise<boolean> {
    const result = await processes.run(["tmux", "has-session", "-t", `=${name}`]);
    return result.code === 0;
  },

  newSession(name: string, cwd: string, command: string[]): Promise<void> {
    return run(["new-session", "-d", "-s", name, "-c", cwd, ...command]);
  },

  killSession(name: string): Promise<void> {
    return run(["kill-session", "-t", `=${name}`]);
  },
};

/** Throws with tmux's stderr on a non-zero exit. */
async function run(args: string[]): Promise<void> {
  const result = await processes.run(["tmux", ...args]);
  if (result.code === 0) return;
  const reason = result.stderr.trim();
  throw new TenboxError(`tmux ${args[0]} failed: ${reason}`, "tmux");
}
