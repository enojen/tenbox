import { setupError } from "../../domain/errors/tasks.ts";
import { elapsedMs } from "../../domain/utils.ts";
import { log } from "../infra/env.ts";
import { shell } from "../infra/shell.ts";

/** The setup ran and passed. */
interface SetupRan {
  state: "ran";
  cmd: string;
  exit_code: number;
  duration_ms: number;
}

/** The setup did not run: `--no-setup` or no `setup:` in the manifest. */
interface SetupSkipped {
  state: "skipped";
  reason: string;
}

export type SetupResult = SetupRan | SetupSkipped;

/** The manifest command that prepares a new task worktree. */
export const setups = { run };

const MS_PER_MINUTE = 60_000;
const SETUP_TIMEOUT_MINUTES = 15;
const SETUP_TIMEOUT_MS = SETUP_TIMEOUT_MINUTES * MS_PER_MINUTE;
const SETUP_OUTPUT_TAIL_LINES = 30;

/** Runs the manifest's `setup:` in the task worktree; a failure stops `tenbox start`. */
async function run(
  taskWorktree: string,
  cmd: string | undefined,
  wanted: boolean,
): Promise<SetupResult> {
  if (!wanted) return { state: "skipped", reason: "--no-setup" };
  if (!cmd) return { state: "skipped", reason: "no setup: in tenbox.yaml" };
  log(`tenbox start: setup: ${cmd}`);
  const started = performance.now();
  const result = await shell.run(cmd, { cwd: taskWorktree, timeoutMs: SETUP_TIMEOUT_MS });
  const duration_ms = elapsedMs(started);
  if (result.code !== 0) {
    const output = result.output.split("\n").slice(-SETUP_OUTPUT_TAIL_LINES).join("\n");
    throw setupError(result.code, cmd, output);
  }
  return { state: "ran", cmd, exit_code: result.code, duration_ms };
}
