import path from "node:path";
import { durations } from "../../domain/utils.ts";
import { runCli } from "../main.ts";

const MAIN_TS = path.join(import.meta.dir, "..", "main.ts");

/** A process starts some ms after the step before it; a file written just before is older than
 * its start, also with the coarse clock of file times. */
const START_GAP_MS = 5;

/** What a run of the CLI leaves: its exit code, stdout and stderr. */
export interface CliOutput {
  code: number;
  out: string;
  err: string;
}

interface InProcessRun {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

type Write = typeof process.stdout.write;

let busy = false;

/** cwd, env and output belong to one command at a time; a second one meanwhile needs a process. */
export const inProcessBusy = (): boolean => busy;

/**
 * Runs `tenbox <args>` in the test process with the cwd, env, output and start time a process of
 * its own would have, and puts them back after. `Bun.main` is the CLI, so `runSelf` starts the CLI.
 */
export async function runInProcess(run: InProcessRun): Promise<CliOutput> {
  busy = true;
  await Bun.sleep(START_GAP_MS);
  const saved = {
    cwd: process.cwd(),
    env: { ...process.env },
    main: Bun.main,
    uptime: process.uptime,
    out: process.stdout.write,
    err: process.stderr.write,
  };
  const out: string[] = [];
  const err: string[] = [];
  const startedMs = performance.now();
  process.chdir(run.cwd);
  Object.assign(process.env, run.env);
  Reflect.set(Bun, "main", MAIN_TS);
  process.uptime = () => (performance.now() - startedMs) / durations.MS_PER_SECOND;
  process.stdout.write = collect(out);
  process.stderr.write = collect(err);
  try {
    const code = await runCli(run.args);
    return { code, out: out.join(""), err: err.join("") };
  } finally {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    process.uptime = saved.uptime;
    Reflect.set(Bun, "main", saved.main);
    process.chdir(saved.cwd);
    restoreEnv(saved.env);
    busy = false;
  }
}

function collect(chunks: string[]): Write {
  return (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
