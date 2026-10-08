import os from "node:os";
import path from "node:path";
import { DEFAULT_FAILURE_PATTERN } from "../../domain/failures.ts";

export interface Env {
  cwd: string;
  /** `~/wt`; `TENBOX_WT_ROOT` overrides. */
  wtRoot: string;
  /** `~/wt/.baselines`; `WTBASE_DIR` overrides. */
  baselinesRoot: string;
  /** Used when the manifest has no `failure_pattern`; `WTBASE_PATTERN` overrides. */
  failurePattern: string;
  /** The tenbox checkout with `agents/` and `workflows/`. */
  tenboxRoot: string;
  /** `~/.claude`; `CLAUDE_CONFIG_DIR` overrides. */
  claudeDir: string;
  /** `TENBOX_DEBUG=1`: log every run and print a stack for every error. */
  debug: boolean;
}

/** Read at each call, so tests can set `process.env` and `process.chdir` first. */
export function env(): Env {
  const wtRoot = process.env.TENBOX_WT_ROOT ?? path.join(os.homedir(), "wt");
  return {
    cwd: process.cwd(),
    wtRoot,
    baselinesRoot: process.env.WTBASE_DIR ?? path.join(wtRoot, ".baselines"),
    failurePattern: process.env.WTBASE_PATTERN ?? DEFAULT_FAILURE_PATTERN,
    tenboxRoot: path.resolve(import.meta.dir, "..", ".."),
    claudeDir: process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
    debug: process.env.TENBOX_DEBUG === "1",
  };
}

/** Human text goes to stderr; stdout carries exactly one JSON document per command. */
export function log(text: string): void {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}
