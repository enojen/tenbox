import os from "node:os";
import path from "node:path";
import { DEFAULT_FAILURE_PATTERN } from "../../domain/failures.ts";

export interface Env {
  cwd: string;
  /** `~/wt`; `TENBOX_WT_ROOT` overrides. */
  wtRoot: string;
  /** `~/.tenbox`; `TENBOX_HOME` overrides. */
  tenboxHome: string;
  /** `~/wt/.baselines`; `WTBASE_DIR` overrides. */
  baselinesRoot: string;
  /** Used when the manifest has no `failure_pattern`; `WTBASE_PATTERN` overrides. */
  failurePattern: string;
  /** The checkout this code runs from; `tenbox install` links from its main checkout. */
  tenboxRoot: string;
  /** `~/.claude`; `CLAUDE_CONFIG_DIR` overrides. */
  claudeDir: string;
  /** `~/.kube/config`; `KUBECONFIG` overrides. */
  kubeconfig: string;
  /** The home directory, for a `~/` path in the manifest. */
  home: string;
  /** `TENBOX_DEBUG=1`: log every run and print a stack for every error. */
  debug: boolean;
}

/** Read at each call, so tests can set `process.env` and `process.chdir` first. */
export function env(): Env {
  const wtRoot = process.env.TENBOX_WT_ROOT ?? path.join(os.homedir(), "wt");
  return {
    cwd: process.cwd(),
    wtRoot,
    tenboxHome: process.env.TENBOX_HOME ?? path.join(os.homedir(), ".tenbox"),
    baselinesRoot: process.env.WTBASE_DIR ?? path.join(wtRoot, ".baselines"),
    failurePattern: process.env.WTBASE_PATTERN ?? DEFAULT_FAILURE_PATTERN,
    tenboxRoot: path.resolve(import.meta.dir, "..", ".."),
    claudeDir: process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
    kubeconfig: process.env.KUBECONFIG ?? path.join(os.homedir(), ".kube", "config"),
    home: os.homedir(),
    debug: process.env.TENBOX_DEBUG === "1",
  };
}

/** Human text goes to stderr; stdout carries exactly one JSON document per command. */
export function log(text: string): void {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}
