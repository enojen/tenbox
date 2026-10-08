export interface SpawnOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface Spawned {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Process groups still running, so `stopAll` can end them when tenbox itself is stopped. */
const running = new Set<number>();

/** Spawn without a shell. Tenbox itself spawns only git, tmux, gh, docker and claude. */
export async function spawn(cmd: string[], options: SpawnOptions = {}): Promise<Spawned> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    // Bun.spawn defaults to the env at startup; tests change process.env later.
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // Its own process group: a timeout must also end the command's children, which keep
    // the output pipes open otherwise.
    detached: true,
  });
  running.add(proc.pid);
  let timedOut = false;
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        killGroup(proc.pid);
      }, options.timeoutMs)
    : undefined;
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
    running.delete(proc.pid);
  }
}

/** Ends every running command with its children; detached groups miss the terminal's Ctrl-C. */
export function stopAll(): void {
  for (const pid of running) killGroup(pid);
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group has already exited.
  }
}
