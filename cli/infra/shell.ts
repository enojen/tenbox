import { processes } from "./processes.ts";

export interface ShellResult {
  code: number;
  /** stdout and stderr in one stream, in order. */
  output: string;
  timedOut: boolean;
}

export interface ShellOptions {
  cwd: string;
  timeoutMs?: number;
}

/** The exit code of a timed-out command, as in coreutils `timeout`. */
const TIMEOUT_EXIT_CODE = 124;

/** Manifest commands run through `sh -c`; the subshell and `2>&1` keep both streams in order. */
export const shell = {
  async run(command: string, options: ShellOptions): Promise<ShellResult> {
    const result = await processes.run(["sh", "-c", `( ${command}\n) 2>&1`], options);
    return { code: result.code, output: result.stdout, timedOut: result.timedOut };
  },

  exitCode(result: ShellResult): number {
    return result.timedOut ? TIMEOUT_EXIT_CODE : result.code;
  },
};
