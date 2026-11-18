import { COMMAND, type CommandName } from "../../domain/commands.ts";
import {
  boxNotStartedError,
  logGoneError,
  loginExpiredError,
  machineBusyError,
  machineFailedError,
  machineTimeoutError,
  noLoginError,
  noMachineRunError,
  noProjectIdError,
  noTenportError,
} from "../../domain/errors/tools.ts";
import { usageError } from "../../domain/errors/usage.ts";
import { type ProjectId, type TaskId, taskId } from "../../domain/ids.ts";
import {
  gitAuthor,
  lastingBoxReason,
  RESOURCE_CLASS,
  type ResourceClass,
  RUN_PHASE,
  type RunPhase,
} from "../../domain/machines.ts";
import type { Manifest } from "../../domain/manifests.ts";
import type { Project } from "../../domain/projects.ts";
import { claudeCredentials } from "../infra/claude/credentials.ts";
import { env, type TenportServer } from "../infra/env.ts";
import { gh } from "../infra/gh.ts";
import { failedAnswer } from "../infra/http.ts";
import { pollUntil } from "../infra/poll.ts";
import { type NewRun, type RunState, tenport } from "../infra/tenport.ts";
import { findApiKey } from "../infra/tracker/apiKeys.ts";
import { projects } from "./projects.ts";

/** What one command takes after its id; `tests` commands run the project's tests or the build. */
interface CommandShape {
  valueFlags: string[];
  boolFlags: string[];
  /** The words between the id and the flags. */
  positionals: number;
  tests: boolean;
}

const NO_FLAGS: CommandShape = { valueFlags: [], boolFlags: [], positionals: 0, tests: false };

const MACHINE_COMMANDS = {
  [COMMAND.start]: { ...NO_FLAGS, valueFlags: ["--title"], boolFlags: ["--force"] },
  [COMMAND.build]: { ...NO_FLAGS, tests: true },
  [COMMAND.close]: { ...NO_FLAGS, boolFlags: ["--force"] },
  [COMMAND.approve]: NO_FLAGS,
  [COMMAND.status]: NO_FLAGS,
  [COMMAND.plan]: NO_FLAGS,
  [COMMAND.pr]: { ...NO_FLAGS, boolFlags: ["--ready", "--force", "--wait"] },
  [COMMAND.check]: { ...NO_FLAGS, valueFlags: ["--group", "--tier"], tests: true },
  [COMMAND.decide]: { ...NO_FLAGS, valueFlags: ["--json"], boolFlags: ["--no-build"], tests: true },
  [COMMAND.answer]: { ...NO_FLAGS, positionals: 1, tests: true },
} satisfies Partial<Record<CommandName, CommandShape>>;
type MachineCommand = keyof typeof MACHINE_COMMANDS;

/** The words after `--`: `tenbox <cmd> <id> [flags]`. */
const USAGE =
  "tenbox machine run <id> -- tenbox start|build|close|approve|decide|answer|check|pr|status|plan show <id> [flags]";

const POLL_MS = 2000;
const MS_PER_SECOND = 1000;
/** The Tenport problem codes a machine command acts on. */
const PROBLEM = {
  machineBusy: "machine-busy",
  boxNotStarted: "box-not-started",
  jobGone: "job-gone",
} as const;

/** The project secrets the Job template reads, by the name Tenport gives them. */
const PROJECT_SECRET = { trackerApiKey: "tracker_api_key", ntfyUrl: "ntfy_url" } as const;

interface MachineRunInput {
  id: TaskId;
  /** The words after `--`. */
  words: string[];
  /** With `--wait`: when the wait for a running run of the task gives up; null refuses at once. */
  deadlineMs: number | null;
}

interface MachineRunResult {
  task: TaskId;
  cmd: MachineCommand;
  /** The name of the run in Tenport. */
  run: string;
}

interface MachineWaitInput {
  id: TaskId;
  cmd: MachineCommand;
  run: string;
  deadlineMs: number;
}

/** How a run ended, as Tenport keeps it. */
export interface MachineRunEnd {
  task: TaskId;
  cmd: MachineCommand;
  run: string;
  phase: RunPhase;
  reason: string | null;
  exit_code: number | null;
  oom_kill: number | null;
  /** The JSON result of the tenbox command, null without one. */
  output: Record<string, unknown> | null;
}

/** The task's newest run log: where each text chunk goes, and whether to follow. */
interface MachineLogsInput {
  id: TaskId;
  follow: boolean;
  write: (chunk: string) => void;
}

interface MachineLogsResult {
  task: TaskId;
  run: string;
  phase: RunPhase;
  reason: string | null;
}

/** The Tenport project of the current directory and the server to ask. */
interface TenportProject {
  server: TenportServer;
  projectId: ProjectId;
}

/** A checked command of the task and the project it runs in. */
interface CommandRun {
  id: TaskId;
  cmd: MachineCommand;
  words: string[];
  project: Project;
  manifest: Manifest;
  target: TenportProject;
  deadlineMs: number | null;
}

/** Tenbox commands run as Jobs on the cluster, through Tenport. */
export const machines = { run, wait, list, stop, logs };

/** Refuses before Tenport is called when the command is not allowed or the login is gone. */
async function run(input: MachineRunInput): Promise<MachineRunResult> {
  const { id, words, deadlineMs } = input;
  const cmd = parseCommand(input);
  await ensureLogin();
  const { project, manifest } = await projects.get(env().cwd);
  const target = tenportProject({ project, manifest });
  const name = await startRun({ id, cmd, words, project, manifest, target, deadlineMs });
  return { task: id, cmd, run: name };
}

/**
 * Polls Tenport until the run is no longer Running. A Failed or Unknown run is `machine-failed`
 * with the result in its details; past the deadline `machine-timeout`, and the run goes on.
 */
async function wait(input: MachineWaitInput): Promise<MachineRunEnd> {
  const { id, cmd, run: name, deadlineMs } = input;
  const { server } = await currentProject();
  const check = async () => {
    const state = await tenport.findRun({ server, name });
    return state.phase === RUN_PHASE.running ? null : state;
  };
  const ended = await pollUntil({ check, deadlineMs, intervalMs: POLL_MS });
  if (ended === null) throw machineTimeoutError(id, [name]);
  const { phase, reason, exit_code, oom_kill, output } = ended;
  const result = { task: id, cmd, run: name, phase, reason, exit_code, oom_kill, output };
  if (phase !== RUN_PHASE.succeeded) throw machineFailedError(name, result);
  return result;
}

/** Every run of each task, oldest first. */
async function list(ids: TaskId[]): Promise<RunState[]> {
  const target = await currentProject();
  const runs = await Promise.all(ids.map((id) => taskRuns(target, id)));
  return runs.flat();
}

/** Deletes the Jobs of the task's running runs; the names it stopped. */
async function stop(id: TaskId): Promise<string[]> {
  const target = await currentProject();
  const running = await runningRuns(target, id);
  const stopped: string[] = [];
  for (const name of running) {
    const done = await tenport.stopRun({ server: target.server, name });
    if (done) stopped.push(name);
  }
  return stopped;
}

/** Writes the log of the newest run of the task; its phase is read after the log ends. */
async function logs(input: MachineLogsInput): Promise<MachineLogsResult> {
  const { id, follow, write } = input;
  const target = await currentProject();
  const runs = await taskRuns(target, id);
  const newest = runs.at(-1);
  if (newest === undefined) throw noMachineRunError(id);
  const { server } = target;
  const chunks = await openLog({ server, name: newest.name, follow });
  for await (const chunk of chunks) write(chunk);
  const after = await tenport.findRun({ server, name: newest.name });
  return { task: id, run: after.name, phase: after.phase, reason: after.reason };
}

interface LogOpen {
  server: TenportServer;
  name: string;
  follow: boolean;
}

/**
 * The log stream of a run. A followed log of a box that has not started asks again after
 * Tenport's Retry-After, unless the box waits for something that does not come by itself.
 */
async function openLog(open: LogOpen): Promise<AsyncIterable<string>> {
  for (;;) {
    try {
      return await tenport.streamLog(open);
    } catch (e) {
      await Bun.sleep(retryAfterSeconds({ error: e, open }) * MS_PER_SECOND);
    }
  }
}

interface LogFailure {
  error: unknown;
  open: LogOpen;
}

/** How long to wait before the log is asked for again; throws when the error stands. */
function retryAfterSeconds(failure: LogFailure): number {
  const { error, open } = failure;
  const answer = failedAnswer(error);
  if (answer?.code === PROBLEM.jobGone) throw logGoneError(open.name);
  if (answer?.code !== PROBLEM.boxNotStarted || !open.follow) throw error;
  const lasting = lastingBoxReason(answer.detail ?? "");
  if (lasting !== null) throw boxNotStartedError(open.name, lasting);
  return answer.retryAfterSeconds ?? 1;
}

const taskRuns = (target: TenportProject, id: TaskId): Promise<RunState[]> =>
  tenport.listRuns({ server: target.server, project: target.projectId, task: id });

async function runningRuns(target: TenportProject, id: TaskId): Promise<string[]> {
  const runs = await taskRuns(target, id);
  return runs.filter((r) => r.phase === RUN_PHASE.running).map((r) => r.name);
}

interface ProjectOfDir {
  project: Project;
  manifest: Manifest;
}

async function currentProject(): Promise<TenportProject> {
  const { project, manifest } = await projects.get(env().cwd);
  return tenportProject({ project, manifest });
}

/** The project id of `tenbox.yaml` is the id Tenport gave the project. */
function tenportProject(of: ProjectOfDir): TenportProject {
  const { project, manifest } = of;
  const server = env().tenport;
  if (server === null) throw noTenportError();
  if (manifest.id === undefined) throw noProjectIdError(project.mainDir);
  return { server, projectId: manifest.id };
}

/** Writes the project secrets, then posts the run; `--wait` asks again while the task is busy. */
async function startRun(command: CommandRun): Promise<string> {
  const { id, target, deadlineMs } = command;
  const run = await newRun(command);
  await saveProjectSecrets(command);
  const post = () => postRun({ target, run });
  if (deadlineMs === null) {
    const started = await post();
    return started ?? busy(target, id);
  }
  const started = await pollUntil({ check: post, deadlineMs, intervalMs: POLL_MS });
  if (started !== null) return started;
  const running = await runningRuns(target, id);
  throw machineTimeoutError(id, running);
}

interface RunPost {
  target: TenportProject;
  run: NewRun;
}

/** The name of the started run; null while a run of the task is still Running. */
async function postRun(post: RunPost): Promise<string | null> {
  const { target, run } = post;
  try {
    return await tenport.startRun({ server: target.server, run });
  } catch (e) {
    if (failedAnswer(e)?.code !== PROBLEM.machineBusy) throw e;
    return null;
  }
}

async function busy(target: TenportProject, id: TaskId): Promise<never> {
  const running = await runningRuns(target, id);
  throw machineBusyError(id, running);
}

async function newRun(command: CommandRun): Promise<NewRun> {
  const { id, cmd, words, project, manifest, target } = command;
  const user = await gh.user(project.mainDir);
  const author = gitAuthor(user);
  return {
    project: target.projectId,
    task: id,
    command: words,
    base: manifest.base,
    class: resourceClass(command),
    ...(manifest.setup === undefined ? {} : { setup: manifest.setup }),
    author,
    services: MACHINE_COMMANDS[cmd].tests ? manifest.machine.services : [],
    env: manifest.machine.env,
  };
}

/**
 * The tracker key and the ntfy URL this computer uses for the project, as the project secrets the
 * Job template reads. A value the project lacks is left out.
 */
async function saveProjectSecrets(command: CommandRun): Promise<void> {
  const { manifest, target } = command;
  const values = {
    [PROJECT_SECRET.trackerApiKey]: findApiKey(manifest.tracker),
    [PROJECT_SECRET.ntfyUrl]: manifest.notify.ntfy ?? null,
  };
  for (const [name, value] of Object.entries(values)) {
    if (value === null) continue;
    const { server, projectId } = target;
    await tenport.saveProjectSecret({ server, project: projectId, name, value });
  }
}

/**
 * A command that runs the project's tests or sends the build takes `machine.class`, `start`
 * takes `machine.plan_class`.
 */
function resourceClass(command: CommandRun): ResourceClass {
  if (MACHINE_COMMANDS[command.cmd].tests) return command.manifest.machine.class;
  if (command.cmd === COMMAND.start) return command.manifest.machine.plan_class;
  return RESOURCE_CLASS.plan;
}

/** The command after `--`, checked: only the flags of its command. */
function parseCommand(input: MachineRunInput): MachineCommand {
  const [tool, cmd, ...rest] = input.words;
  const command = Object.keys(MACHINE_COMMANDS).find((c): c is MachineCommand => c === cmd);
  if (tool !== "tenbox" || command === undefined) throw usageError(`usage: ${USAGE}`);
  // `plan show <id>` is the one command with a word before the id.
  const tail = command === COMMAND.plan ? afterShow(rest) : rest;
  const [id, ...args] = tail;
  if (id === undefined || taskId(id) !== input.id) throw usageError(`usage: ${USAGE}`);
  if (!argsFit({ shape: MACHINE_COMMANDS[command], args })) throw usageError(`usage: ${USAGE}`);
  return command;
}

function afterShow(words: string[]): string[] {
  return words[0] === "show" ? words.slice(1) : [];
}

interface ArgsInput {
  shape: CommandShape;
  /** The words after the id. */
  args: string[];
}

/** The positional words, then only flags of the command, a value flag with its value. */
function argsFit(input: ArgsInput): boolean {
  const { shape, args } = input;
  if (args.length < shape.positionals) return false;
  const flags = args.slice(shape.positionals);
  let i = 0;
  while (i < flags.length) {
    const flag = flags[i] ?? "";
    if (shape.boolFlags.includes(flag)) i += 1;
    else if (shape.valueFlags.includes(flag) && flags[i + 1] !== undefined) i += 2;
    else return false;
  }
  return true;
}

/** The refresh token must still be valid: the login sync gives the box the same file. */
async function ensureLogin(): Promise<void> {
  const expiry = await claudeCredentials.findRefreshExpiry();
  if (expiry === null) throw noLoginError(claudeCredentials.file());
  if (expiry <= Date.now()) throw loginExpiredError(new Date(expiry));
}
