/** In-memory ports for `app/` tests. No git, no disk, no processes. */
import path from "node:path";
import { type Baseline, DEFAULT_FAILURE_PATTERN } from "../domain/failures.ts";
import type { BaselineMeta, BaselineStore, Files, Git, Ports, Shell, ShellResult, Tmux } from "../ports.ts";
import { noneTracker } from "../tracker/none.ts";

export class FakeFiles implements Files {
  readonly data = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly mtimes = new Map<string, number>();
  /** link path -> target path */
  readonly links = new Map<string, string>();

  seed(entries: Record<string, string>): this {
    for (const [p, t] of Object.entries(entries)) this.put(p, t);
    return this;
  }
  put(p: string, text: string, mtime = 1): void {
    this.data.set(p, text);
    this.mtimes.set(p, mtime);
    for (let d = path.dirname(p); d !== path.dirname(d); d = path.dirname(d)) this.dirs.add(d);
  }
  async exists(p: string) {
    return this.data.has(p) || this.dirs.has(p) || this.links.has(p);
  }
  async isDir(p: string) {
    return this.dirs.has(p);
  }
  async read(p: string) {
    return this.data.get(p) ?? null;
  }
  async write(p: string, text: string) {
    this.put(p, text);
  }
  async mkdir(p: string) {
    for (let d = p; d !== path.dirname(d); d = path.dirname(d)) this.dirs.add(d);
  }
  async list(p: string) {
    const prefix = `${p}/`;
    const names = new Set<string>();
    for (const k of [...this.data.keys(), ...this.dirs, ...this.links.keys()]) if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split("/")[0]!);
    return [...names];
  }
  async mtime(p: string) {
    return this.mtimes.get(p) ?? 0;
  }
  async symlink(target: string, link: string) {
    if (await this.exists(link)) throw new Error(`fake symlink: ${link} exists`);
    this.links.set(link, target);
  }
  async readLink(p: string) {
    return this.links.get(p) ?? null;
  }
}

/** Save order is age: the last entry for a check is the newest. */
export class FakeBaselineStore implements BaselineStore {
  readonly saved: { project: string; check: string; baseline: Baseline; meta: BaselineMeta }[] = [];
  async find(project: string, check: string, sha: string) {
    return this.saved.findLast((e) => e.project === project && e.check === check && e.baseline.sha === sha)?.baseline ?? null;
  }
  async newest(project: string, check: string) {
    return this.saved.findLast((e) => e.project === project && e.check === check)?.baseline ?? null;
  }
  async save(project: string, check: string, baseline: Baseline, meta: BaselineMeta) {
    this.saved.push({ project, check, baseline, meta });
  }
}

export type GitScript = (args: string[], cwd: string) => string | null | undefined;

/** Answers `git` calls from a script; records every call. */
export class FakeGit implements Git {
  readonly calls: { args: string[]; cwd: string }[] = [];
  constructor(private readonly script: GitScript) {}
  async run(args: string[], cwd: string) {
    const out = await this.try(args, cwd);
    if (out === null) throw new Error(`fake git refused: git ${args.join(" ")} (in ${cwd})`);
    return out;
  }
  async try(args: string[], cwd: string) {
    this.calls.push({ args, cwd });
    const out = this.script(args, cwd);
    return out === undefined ? null : out;
  }
  readonly excludes: { commonDir: string; patterns: readonly string[] }[] = [];
  async ensureExcludes(commonDir: string, patterns: readonly string[]) {
    this.excludes.push({ commonDir, patterns });
    return [...patterns];
  }
}

export class FakeShell implements Shell {
  readonly calls: { command: string; cwd: string }[] = [];
  constructor(private readonly script: (command: string, cwd: string) => ShellResult) {}
  async run(command: string, opts: { cwd: string }) {
    this.calls.push({ command, cwd: opts.cwd });
    return this.script(command, opts.cwd);
  }
}

export class FakeTmux implements Tmux {
  readonly sessions = new Map<string, { cwd: string; command: string[] }>();
  async hasSession(name: string) {
    return this.sessions.has(name);
  }
  async newSession(name: string, cwd: string, command: string[]) {
    this.sessions.set(name, { cwd, command });
  }
}

export interface FakePorts extends Ports {
  files: FakeFiles;
  git: FakeGit;
  shell: FakeShell;
  tmux: FakeTmux;
  baselines: FakeBaselineStore;
  logs: string[];
}

export function fakePorts(opts: { cwd: string; wtRoot: string; tenboxRoot?: string; claudeDir?: string; git: GitScript; shell?: (c: string, cwd: string) => ShellResult; which?: (b: string) => string | null }): FakePorts {
  const logs: string[] = [];
  let tick = 0;
  return {
    files: new FakeFiles(),
    git: new FakeGit(opts.git),
    shell: new FakeShell(opts.shell ?? (() => ({ code: 0, output: "", timedOut: false }))),
    tmux: new FakeTmux(),
    baselines: new FakeBaselineStore(),
    env: {
      cwd: opts.cwd,
      wtRoot: opts.wtRoot,
      baselinesRoot: path.join(opts.wtRoot, ".baselines"),
      failurePattern: DEFAULT_FAILURE_PATTERN,
      tenboxRoot: opts.tenboxRoot ?? "/tenbox",
      claudeDir: opts.claudeDir ?? "/home/u/.claude",
      which: opts.which ?? (() => "/usr/bin/claude"),
    },
    clock: { now: () => new Date(1_700_000_000_000 + 1000 * tick++) },
    log: (t) => logs.push(t),
    tracker: () => noneTracker,
    logs,
  };
}
