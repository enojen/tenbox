import path from "node:path";
import { COMMAND, type CommandName } from "../../domain/commands.ts";
import {
  githubTokenFileError,
  loginExpiredError,
  machineBusyError,
  noLoginError,
  noMachineRunError,
  noProjectIdError,
  serviceError,
} from "../../domain/errors/tools.ts";
import { usageError } from "../../domain/errors/usage.ts";
import { type ProjectId, type TaskId, taskId } from "../../domain/ids.ts";
import {
  JOB_STATUS,
  type JobStatus,
  RESOURCE_CLASS,
  type ResourceClass,
  RUN_STATUS,
  type RunConclusion,
  type RunStatus,
  VOLUME_STATE,
  type VolumeState,
} from "../../domain/machines.ts";
import type { Manifest } from "../../domain/manifests.ts";
import type { Project } from "../../domain/projects.ts";
import { claudeCredentials } from "../infra/claude/credentials.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import {
  type Cluster,
  type Job,
  kubernetes,
  type Service,
  type TemplateFields,
} from "../infra/kubernetes.ts";
import { pollUntil } from "../infra/poll.ts";
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
  [COMMAND.start]: { ...NO_FLAGS, valueFlags: ["--title"] },
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

/** The image of the box: what runs a tenbox command in a Job (`machines/k8s/`). */
const BOX_IMAGE = "ghcr.io/enojen/tenbox-box:latest";
/** The label of every Job and volume of tenyard. */
const TENYARD_SELECTOR = "app=tenyard";

/** The words after `--`: `tenbox <cmd> <id> [flags]`. */
const USAGE =
  "tenbox machine run <id> -- tenbox start|build|close|approve|decide|answer|check|pr|status|plan show <id> [flags]";

interface MachineRunInput {
  id: TaskId;
  /** The words after `--`. */
  words: string[];
}

interface MachineRunResult {
  task: TaskId;
  cmd: MachineCommand;
  url: string;
}

/** One Job of the cluster. */
export interface MachineRunRow {
  id: string;
  title: string;
  status: RunStatus;
  conclusion: RunConclusion | null;
  url: string;
  created: string;
}

/** Tenbox commands run as a Job on the cluster. */
export const machines = { run, list, stop, remove, logs };

/** The task's newest Job log: where each text chunk goes, and whether to follow. */
interface MachineLogsInput {
  id: TaskId;
  follow: boolean;
  write: (chunk: string) => void;
}

interface MachineLogsResult {
  task: TaskId;
  job: string;
  status: JobStatus;
}

const POD_POLL_MS = 2000;
/** The volume of a task and what `remove` did to it. */
export interface MachineVolume {
  name: string;
  state: VolumeState;
}

/** A checked command of the task and the project it runs in. */
interface CommandRun {
  id: TaskId;
  cmd: MachineCommand;
  words: string[];
  project: Project;
  projectId: ProjectId;
  manifest: Manifest;
}

/**
 * Refuses before the cluster is called when the command is not allowed, the login is gone or the
 * project has no id.
 */
async function run(input: MachineRunInput): Promise<MachineRunResult> {
  const { id, words } = input;
  const cmd = parseCommand(input);
  await ensureLogin();
  const { project, manifest } = await projects.get(env().cwd);
  const projectId = manifest.id;
  if (projectId === undefined) throw noProjectIdError(project.mainDir);
  const url = await runJob({ id, cmd, words, project, projectId, manifest });
  return { task: id, cmd, url };
}

/** Deletes the active Jobs of the task; the names it deleted. The volume stays. */
async function stop(id: TaskId): Promise<string[]> {
  const cluster = await kubernetes.readCluster(env().kubeconfig);
  const names = await activeJobs(cluster, id);
  const stopped: string[] = [];
  for (const name of names) {
    const deleted = await kubernetes.removeJob({ cluster, name });
    if (deleted) stopped.push(name);
  }
  return stopped;
}

/** Deletes the volume of the task unless a Job of the task is active. */
async function remove(id: TaskId): Promise<MachineVolume> {
  const cluster = await kubernetes.readCluster(env().kubeconfig);
  await ensureIdle(cluster, id);
  const name = `task-${kubeName(id)}`;
  const deleted = await kubernetes.removeVolume({ cluster, name });
  return { name, state: deleted ? VOLUME_STATE.deleted : VOLUME_STATE.missing };
}

/** The task id in lower case, `_` as `-`: a Kubernetes name. */
const kubeName = (id: TaskId): string => id.toLowerCase().replaceAll("_", "-");

async function list(): Promise<MachineRunRow[]> {
  const cluster = await kubernetes.readCluster(env().kubeconfig);
  const jobs = await kubernetes.listJobs(cluster, TENYARD_SELECTOR);
  return jobs.map(toRow);
}

/** Writes the log of the newest Job of the task; its status is read after the log ends. */
async function logs(input: MachineLogsInput): Promise<MachineLogsResult> {
  const { id, follow, write } = input;
  const cluster = await kubernetes.readCluster(env().kubeconfig);
  const jobs = await kubernetes.listJobs(cluster, `task=${id}`);
  const newest = jobs.sort((a, b) => b.created.localeCompare(a.created))[0];
  if (newest === undefined) throw noMachineRunError(id);
  const pod = await waitForPod({ cluster, job: newest.name, follow });
  const chunks = await kubernetes.streamLog({ cluster, pod, follow });
  for await (const chunk of chunks) write(chunk);
  const after = await kubernetes.listJobs(cluster, `task=${id}`);
  const job = after.find((j) => j.name === newest.name) ?? newest;
  return { task: id, job: newest.name, status: jobStatus(job) };
}

function jobStatus(job: Job): JobStatus {
  if (job.succeeded > 0) return JOB_STATUS.success;
  if (job.failed > 0) return JOB_STATUS.failure;
  return JOB_STATUS.inProgress;
}

/** The pod to read, and whether to wait for it to start. */
interface PodWait {
  cluster: Cluster;
  job: string;
  follow: boolean;
}

/** Without `follow`, a pod that is not running yet is left to the API's own answer. */
async function waitForPod(input: PodWait): Promise<string> {
  const { cluster, job, follow } = input;
  const check = async () => {
    const pod = await kubernetes.findPod(cluster, job);
    return pod !== null && (pod.started || !follow) ? pod.name : null;
  };
  const deadlineMs = follow ? Number.POSITIVE_INFINITY : Date.now();
  const found = await pollUntil({ check, deadlineMs, intervalMs: POD_POLL_MS });
  if (found === null) throw serviceError("kubernetes", "kubernetes", `Job ${job} has no pod yet`);
  return found;
}

function toRow(job: Job): MachineRunRow {
  const row = { id: job.name, title: job.cmd, url: job.url, created: job.created };
  const status = jobStatus(job);
  if (status === JOB_STATUS.inProgress)
    return { ...row, status: RUN_STATUS.inProgress, conclusion: null };
  return { ...row, status: RUN_STATUS.completed, conclusion: status };
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

/** The refresh token must still be valid: the machine takes its login from the same file. */
async function ensureLogin(): Promise<void> {
  const expiry = await claudeCredentials.findRefreshExpiry();
  if (expiry === null) throw noLoginError(claudeCredentials.file());
  if (expiry <= Date.now()) throw loginExpiredError(new Date(expiry));
}

/** Every Job gets the project and its origin: the box clones the project on a new volume. */
async function runJob(command: CommandRun): Promise<string> {
  const { id, manifest, projectId } = command;
  const values = await projectSecretValues(manifest);
  const cluster = await kubernetes.readCluster(env().kubeconfig);
  const dir = homePath(manifest.machine.template);
  const services = await Promise.all(
    serviceNames(command).map((name) =>
      kubernetes.readService(path.join(dir, "services", `${name}.yaml`)),
    ),
  );
  const fields = await templateFields({ command, services });
  const volume = await kubernetes.readTemplate({ file: path.join(dir, "pvc.yaml"), fields });
  const file = path.join(dir, "job.yaml");
  const template = await kubernetes.readTemplate({ file, fields });
  const job = kubernetes.addServices({ file, job: template, services });
  await ensureIdle(cluster, id);
  await kubernetes.saveSecret({ cluster, name: `project-${projectId}`, values });
  await kubernetes.ensureVolume({ cluster, object: volume });
  return kubernetes.createJob({ cluster, object: job });
}

/**
 * The project Secret the tenyard Job template reads, `project-<project id>`: the tracker key and
 * the ntfy URL this computer uses for the project, and the project's GitHub token. A value the
 * project lacks is left out.
 */
async function projectSecretValues(manifest: Manifest): Promise<Record<string, string>> {
  const trackerKey = findApiKey(manifest.tracker);
  const ntfy = manifest.notify.ntfy;
  const githubToken = await readGithubToken(manifest);
  return {
    ...(trackerKey === null ? {} : { tracker_api_key: trackerKey }),
    ...(ntfy === undefined ? {} : { ntfy_url: ntfy }),
    ...(githubToken === null ? {} : { github_token: githubToken }),
  };
}

/** The trimmed text of `machine.github_token_file`; null without the key. */
async function readGithubToken(manifest: Manifest): Promise<string | null> {
  const key = manifest.machine.github_token_file;
  if (key === undefined) return null;
  const file = homePath(key);
  const text = await files.read(file);
  if (text === null) throw githubTokenFileError(file, "file not found");
  const token = text.trim();
  if (token === "") throw githubTokenFileError(file, "file is empty");
  return token;
}

interface FieldsInput {
  command: CommandRun;
  services: Service[];
}

async function templateFields(input: FieldsInput): Promise<TemplateFields> {
  const { command, services } = input;
  const { id, words, project, projectId, manifest } = command;
  const boxEnv = Object.assign({}, ...services.map((s) => s.env), manifest.machine.env);
  const repo = await originUrl(project);
  const name = resourceClass(command);
  const file = path.join(homePath(manifest.machine.template), "classes.yaml");
  const resources = await kubernetes.readClass({ file, name });
  return {
    name: kubeName(id),
    task: id,
    run: runStamp(new Date()),
    project: project.name,
    projectId,
    repo,
    image: BOX_IMAGE,
    cmd: words.map(shellWord).join(" "),
    env: JSON.stringify(boxEnv),
    class: name,
    cpu: resources.cpu,
    memory: resources.memory,
  };
}

/** Only a command that runs the project's tests or sends the build takes `machine.class`. */
function resourceClass(command: CommandRun): ResourceClass {
  if (MACHINE_COMMANDS[command.cmd].tests) return command.manifest.machine.class;
  return RESOURCE_CLASS.plan;
}

async function activeJobs(cluster: Cluster, id: TaskId): Promise<string[]> {
  const jobs = await kubernetes.listJobs(cluster, `task=${id}`);
  return jobs.filter((job) => job.active > 0).map((job) => job.name);
}

function serviceNames(command: CommandRun): string[] {
  if (MACHINE_COMMANDS[command.cmd].tests) return command.manifest.machine.services;
  return [];
}

/** Two commands of one task must not share its volume, as tenyard `task/run.sh` refuses too. */
async function ensureIdle(cluster: Cluster, id: TaskId): Promise<void> {
  const active = await activeJobs(cluster, id);
  if (active.length > 0) throw machineBusyError(id, active);
}

/** `MMDD-HHMMSS` in UTC, as tenyard `task/run.sh` names a run. */
function runStamp(now: Date): string {
  return now.toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d).*$/, "$1$2-$3$4$5");
}

const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

/** The box runs `TENBOX_CMD` with `bash -c`: a title must stay one word and run nothing. */
function shellWord(word: string): string {
  if (SHELL_SAFE.test(word)) return word;
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** A `~/` path of the manifest, from the home directory. */
function homePath(dir: string): string {
  if (dir.startsWith("~/")) return path.join(env().home, dir.slice("~/".length));
  return dir;
}

/** The origin of the main checkout, without a token in it. */
async function originUrl(project: Project): Promise<string> {
  const repo = await git.findRemoteUrl(project.mainDir);
  if (repo === null) throw usageError(`${project.name} has no git remote origin`);
  return withoutUserinfo(repo);
}

/** A token in the origin URL would land in the Job. */
function withoutUserinfo(url: string): string {
  if (!URL.canParse(url)) return url;
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  return parsed.href;
}
