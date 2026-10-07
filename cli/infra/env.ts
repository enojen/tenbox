import os from "node:os";
import path from "node:path";
import { DEFAULT_FAILURE_PATTERN } from "../domain/failures.ts";
import type { Clock, Env, Log } from "../ports.ts";

export function env(): Env {
  const wtRoot = process.env.TENBOX_WT_ROOT ?? path.join(os.homedir(), "wt");
  return {
    cwd: process.cwd(),
    wtRoot,
    baselinesRoot: process.env.WTBASE_DIR ?? path.join(wtRoot, ".baselines"),
    failurePattern: process.env.WTBASE_PATTERN ?? DEFAULT_FAILURE_PATTERN,
    tenboxRoot: path.resolve(import.meta.dir, "..", ".."),
    claudeDir: process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
    which: (binary) => Bun.which(binary),
  };
}

export const clock: Clock = { now: () => new Date() };

/** Human text goes to stderr; stdout carries exactly one JSON document per command. */
export const log: Log = (text) => {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
};
