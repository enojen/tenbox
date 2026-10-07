/**
 * Ports: everything that touches the operating system, as interfaces.
 * `infra/` implements them for real; tests pass fakes. `app/` sees only these.
 */
import type { Baseline } from "./domain/failures.ts";
import type { TrackerConfig, TrackerKind } from "./domain/manifest.ts";

export interface Git {
  /** Trimmed stdout; throws TenboxError on a non-zero exit. */
  run(args: string[], cwd: string): Promise<string>;
  /** Trimmed stdout, or null on a non-zero exit. */
  try(args: string[], cwd: string): Promise<string | null>;
  /** Adds the missing patterns to `<commonDir>/info/exclude`; returns the ones added. */
  ensureExcludes(commonDir: string, patterns: readonly string[]): Promise<string[]>;
}

export interface ShellResult {
  code: number;
  /** stdout and stderr in one stream, in order. */
  output: string;
  timedOut: boolean;
}

export interface Shell {
  run(command: string, opts: { cwd: string; timeoutMs?: number }): Promise<ShellResult>;
}

export interface Tmux {
  hasSession(name: string): Promise<boolean>;
  newSession(name: string, cwd: string, command: string[]): Promise<void>;
}

export interface Files {
  exists(p: string): Promise<boolean>;
  isDir(p: string): Promise<boolean>;
  read(p: string): Promise<string | null>;
  write(p: string, text: string): Promise<void>;
  mkdir(p: string): Promise<void>;
  list(p: string): Promise<string[]>;
  mtime(p: string): Promise<number>;
  symlink(target: string, link: string): Promise<void>;
  /** The target of the symlink at `p`; null when `p` is missing or not a symlink. */
  readLink(p: string): Promise<string | null>;
}

export interface BaselineMeta {
  date: string;
  cmd: string;
  exit_code: number;
}

/** Failure lines of the base commit, per project and check. The devbox `wtbase` store. */
export interface BaselineStore {
  /** The baseline taken at `sha`, or null. */
  find(project: string, check: string, sha: string): Promise<Baseline | null>;
  /** The most recently saved baseline for the check, or null. */
  newest(project: string, check: string): Promise<Baseline | null>;
  save(project: string, check: string, baseline: Baseline, meta: BaselineMeta): Promise<void>;
}

export interface Env {
  cwd: string;
  /** `~/wt`; `TENBOX_WT_ROOT` overrides. */
  wtRoot: string;
  /** `~/wt/.baselines`; `WTBASE_DIR` overrides. */
  baselinesRoot: string;
  /** Fallback when the manifest has no `failure_pattern`: `WTBASE_PATTERN`, else the default. */
  failurePattern: string;
  /** The tenbox checkout that holds `agents/` and `workflows/`. */
  tenboxRoot: string;
  /** `~/.claude`; `CLAUDE_CONFIG_DIR` overrides. */
  claudeDir: string;
  which(binary: string): string | null;
}

export interface Clock {
  now(): Date;
}

export interface Log {
  (text: string): void;
}

export type TaskStatus = "in_progress" | "in_review" | "done";

export interface TrackerTask {
  id: string;
  title: string;
  description: string;
  url: string;
  status: string;
}

/** The only place in Tenbox that knows which tracker a project uses. */
export interface Tracker {
  readonly kind: TrackerKind;
  getTask(id: string): Promise<TrackerTask>;
  setStatus(id: string, status: TaskStatus): Promise<void>;
}

export interface Ports {
  git: Git;
  shell: Shell;
  tmux: Tmux;
  files: Files;
  baselines: BaselineStore;
  env: Env;
  clock: Clock;
  log: Log;
  tracker(config: TrackerConfig): Tracker;
}
