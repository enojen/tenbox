import { z } from "zod";
import { claudeError } from "../../../domain/errors/tools.ts";
import { parseJson } from "../../../domain/utils.ts";
import { processes } from "../processes.ts";
import type { ResumableRun } from "./sessionFiles.ts";

/** What a task's background `claude` session starts with. */
export interface ClaudeStart {
  model: string;
  /** A dir outside the worktree that `claude` may read and write: the task dir. */
  addDir: string;
  /** The `-n` name of the session. */
  name: string;
  prompt: string;
}

/** One background session of `claude agents --json`. */
export interface BackgroundSession {
  /** The id that `claude attach` and `claude stop` take. */
  id: string;
  cwd: string;
  startedAt: number;
  /** True while the session works or waits for a person. */
  busy: boolean;
}

/** A command run in one directory with the `claude` binary found in `PATH`. */
export interface ClaudeRun {
  claude: string;
  cwd: string;
}

/** The background session commands of the `claude` CLI. */
export const claude = { find, startBackground, resumeBackground, listBackground, attach, stop };

/** A stopped background session to wake with one more prompt. */
export interface ClaudeResume {
  /** The full session id; the 8-char id of `claude agents` is not enough. */
  session: string;
  prompt: string;
}

/** The prompt that resumes a workflow run: same script and args up to the answer, so every earlier agent returns from the cache. */
export function resumePrompt(run: ResumableRun, args: object): string {
  return [
    `Run the Workflow tool with scriptPath ${JSON.stringify(run.scriptPath)},`,
    `resumeFromRunId ${JSON.stringify(run.runId)} and these args: ${JSON.stringify(args)}`,
  ].join(" ");
}

/** The output of `claude agents --json`: interactive and background sessions. */
const AgentListSchema = z.array(
  z.object({
    id: z.string().optional(),
    cwd: z.string(),
    kind: z.string(),
    startedAt: z.number(),
    state: z.string().optional(),
  }),
);

const BACKGROUND = "background";

/** The `state` values of a session that a second build must not disturb. A `blocked` session waits
 * for a person, as a planner does after its plan, so it is not busy. */
const BUSY_STATES = ["working"];

/** The `claude` binary in `PATH`, or null. */
function find(): string | null {
  return processes.which("claude");
}

/**
 * `--bg` returns once the session runs. `--add-dir` and `--allowedTools` take several values, so
 * `--` keeps the prompt out of them. `Workflow` is allowed so the slash command runs unattended.
 */
async function startBackground(run: ClaudeRun, start: ClaudeStart): Promise<void> {
  const args = ["--bg", "--model", start.model, "--add-dir", start.addDir, "-n", start.name];
  await runChecked(run, [...args, "--allowedTools", "Workflow", "--", start.prompt]);
}

/**
 * Wakes the same session with its saved options; any other flag makes claude start a copy
 * under a new id instead, so none is passed.
 */
async function resumeBackground(run: ClaudeRun, resume: ClaudeResume): Promise<void> {
  await runChecked(run, ["--bg", "--resume", resume.session, "--", resume.prompt]);
}

/** The background sessions started in exactly `run.cwd`; `--cwd` also lists its subdirs. */
async function listBackground(run: ClaudeRun): Promise<BackgroundSession[]> {
  const stdout = await runChecked(run, ["agents", "--json", "--cwd", run.cwd]);
  const parsed = AgentListSchema.safeParse(parseJson(stdout));
  if (!parsed.success) throw claudeError("agents", "output is not a session list");
  const sessions: BackgroundSession[] = [];
  for (const { id, cwd, kind, startedAt, state } of parsed.data) {
    if (kind === BACKGROUND && id !== undefined && cwd === run.cwd) {
      sessions.push({ id, cwd, startedAt, busy: BUSY_STATES.includes(state ?? "") });
    }
  }
  return sessions;
}

/** Opens the session in this terminal until the user leaves it. */
async function attach(run: ClaudeRun, id: string): Promise<void> {
  const code = await processes.runInTerminal([run.claude, "attach", id], { cwd: run.cwd });
  if (code !== 0) throw claudeError("attach", `exit ${code}`);
}

/** The conversation stays, so `tenbox stats` can still read it. */
async function stop(run: ClaudeRun, id: string): Promise<void> {
  await runChecked(run, ["stop", id]);
}

/** Its stdout; throws with claude's stderr, such as "Workspace not trusted", on a non-zero exit. */
async function runChecked(run: ClaudeRun, args: string[]): Promise<string> {
  const result = await processes.run([run.claude, ...args], { cwd: run.cwd });
  if (result.code === 0) return result.stdout;
  const reason = result.stderr.trim() || result.stdout.trim();
  throw claudeError(args[0] ?? "", reason);
}
