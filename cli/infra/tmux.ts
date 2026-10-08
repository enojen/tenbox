import { TenboxError } from "../domain/errors.ts";
import { spawn } from "./spawn.ts";

export const tmux = {
  async hasSession(name: string): Promise<boolean> {
    const result = await spawn(["tmux", "has-session", "-t", `=${name}`]);
    return result.code === 0;
  },

  async newSession(name: string, cwd: string, command: string[]): Promise<void> {
    const result = await spawn(["tmux", "new-session", "-d", "-s", name, "-c", cwd, ...command]);
    if (result.code !== 0) {
      throw new TenboxError(`tmux new-session failed: ${result.stderr.trim()}`, "tmux");
    }
  },
};
