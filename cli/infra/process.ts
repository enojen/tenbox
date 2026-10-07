import path from "node:path";
import { TenboxError } from "../domain/errors.ts";
import type { Git, Shell, Tmux } from "../ports.ts";
import { files } from "./files.ts";

interface Spawned {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Spawn without a shell. Tenbox itself spawns only git, tmux, gh, docker and claude. */
async function spawn(cmd: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<Spawned> {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, opts.timeoutMs)
    : undefined;
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (timer) clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
}

export const git: Git = {
  async run(args, cwd) {
    const r = await spawn(["git", ...args], { cwd });
    if (r.code !== 0) throw new TenboxError(`git ${args.join(" ")} failed: ${r.stderr.trim() || r.stdout.trim()}`, "git");
    return r.stdout.trim();
  },
  async try(args, cwd) {
    const r = await spawn(["git", ...args], { cwd });
    return r.code === 0 ? r.stdout.trim() : null;
  },
  async ensureExcludes(commonDir, patterns) {
    const file = path.join(commonDir, "info", "exclude");
    const current = (await files.read(file)) ?? "";
    const lines = current.split("\n");
    const added = patterns.filter((p) => !lines.includes(p));
    if (added.length) {
      const sep = current === "" || current.endsWith("\n") ? "" : "\n";
      await files.write(file, `${current}${sep}${added.join("\n")}\n`);
    }
    return added;
  },
};

/** Manifest commands run through `sh -c`; the subshell and `2>&1` keep both streams in order. */
export const shell: Shell = {
  async run(command, opts) {
    const r = await spawn(["sh", "-c", `( ${command}\n) 2>&1`], opts);
    return { code: r.code, output: r.stdout, timedOut: r.timedOut };
  },
};

export const tmux: Tmux = {
  async hasSession(name) {
    return (await spawn(["tmux", "has-session", "-t", `=${name}`])).code === 0;
  },
  async newSession(name, cwd, command) {
    const r = await spawn(["tmux", "new-session", "-d", "-s", name, "-c", cwd, ...command]);
    if (r.code !== 0) throw new TenboxError(`tmux new-session failed: ${r.stderr.trim()}`, "tmux");
  },
};
