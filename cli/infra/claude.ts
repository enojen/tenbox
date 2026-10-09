import { processes } from "./processes.ts";

/** What a task's `claude` session starts with. */
export interface ClaudeStart {
  model: string;
  /** A dir outside the worktree that `claude` may read and write: the task dir. */
  addDir: string;
  prompt: string;
}

/** The `claude` binary in `PATH`, or null. */
export function findClaude(): string | null {
  return processes.which("claude");
}

/** The command line of one session. `--add-dir` takes several dirs, so `--` keeps the prompt out of it. */
export function claudeCommand(claude: string, start: ClaudeStart): string[] {
  return [claude, "--model", start.model, "--add-dir", start.addDir, "--", start.prompt];
}
