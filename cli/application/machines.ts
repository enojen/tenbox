import path from "node:path";
import {
  loginExpiredError,
  machineBusyError,
  noLoginError,
  noProjectIdError,
} from "../../domain/errors/tools.ts";
import { usageError } from "../../domain/errors/usage.ts";
import { type ProjectId, type TaskId, taskId } from "../../domain/ids.ts";
import type { Manifest } from "../../domain/manifests.ts";
import type { Project } from "../../domain/projects.ts";
import { claudeCredentials } from "../infra/claude/credentials.ts";
import { env } from "../infra/env.ts";
import { git } from "../infra/git.ts";
import { type Cluster, type Job, kubernetes, type TemplateFields } from "../infra/kubernetes.ts";
import { findApiKey } from "../infra/tracker/apiKeys.ts";
import { projects } from "./projects.ts";

const MACHINE_COMMANDS = ["start", "build", "close"] as const;
type MachineCommand = (typeof MACHINE_COMMANDS)[number];

/** The image of the box: what runs a tenbox command in a Job (`machines/k8s/`). */
const BOX_IMAGE = "ghcr.io/enojen/tenbox-box:latest";
/** The label of every Job and volume of tenyard. */
const TENYARD_SELECTOR = "app=tenyard";

/** The words after `--`: `tenbox <cmd> <id> [flags]`. */
const USAGE = "tenbox machine run <id> -- tenbox start|build|close <id> [--title X | --force]";

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
  status: "in_progress" | "completed";
  conclusion: "success" | "failure" | null;
  url: string;
  created: string;
}

/** Tenbox commands run as a Job on the cluster. */
export const machines = { run, list };

/** A checked command of the task and the project it runs in. */
interface CommandRun {
  id: TaskId;
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
  const url = await runJob({ id, words, project, projectId, manifest });
  return { task: id, cmd, url };
}

async function list(): Promise<MachineRunRow[]> {
  const cluster = await kubernetes.readCluster(env().kubeconfig);
  const jobs = await kubernetes.listJobs(cluster, TENYARD_SELECTOR);
  return jobs.map(toRow);
}

function toRow(job: Job): MachineRunRow {
  const row = { id: job.name, title: job.cmd, url: job.url, created: job.created };
  if (job.succeeded > 0) return { ...row, status: "completed", conclusion: "success" };
  if (job.failed > 0) return { ...row, status: "completed", conclusion: "failure" };
  return { ...row, status: "in_progress", conclusion: null };
}

/** The command after `--`, checked: only the flags of its command. */
function parseCommand(input: MachineRunInput): MachineCommand {
  const [tool, cmd, id, ...flags] = input.words;
  const command = MACHINE_COMMANDS.find((c) => c === cmd);
  if (tool !== "tenbox" || command === undefined) throw usageError(`usage: ${USAGE}`);
  if (id === undefined || taskId(id) !== input.id) throw usageError(`usage: ${USAGE}`);
  if (!flagsFit(command, flags)) throw usageError(`usage: ${USAGE}`);
  return command;
}

/** `start` takes `--title X`, `close` takes `--force`, `build` takes none. */
function flagsFit(command: MachineCommand, flags: string[]): boolean {
  const [flag, value, ...rest] = flags;
  if (flag === undefined) return true;
  if (command === "start") return flag === "--title" && value !== undefined && rest.length === 0;
  if (command === "close") return flag === "--force" && value === undefined;
  return false;
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
  const cluster = await kubernetes.readCluster(env().kubeconfig);
  const fields = await templateFields(command);
  const dir = homePath(manifest.machine.template);
  const volume = await kubernetes.readTemplate({ file: path.join(dir, "pvc.yaml"), fields });
  const job = await kubernetes.readTemplate({ file: path.join(dir, "job.yaml"), fields });
  await ensureIdle(cluster, id);
  const values = projectSecretValues(manifest);
  await kubernetes.saveSecret({ cluster, name: `project-${projectId}`, values });
  await kubernetes.ensureVolume({ cluster, object: volume });
  return kubernetes.createJob({ cluster, object: job });
}

/**
 * The project Secret the tenyard Job template reads, `project-<project id>`: the tracker key and
 * the ntfy URL this computer uses for the project. A value the project lacks is left out.
 */
function projectSecretValues(manifest: Manifest): Record<string, string> {
  const trackerKey = findApiKey(manifest.tracker);
  const ntfy = manifest.notify.ntfy;
  return {
    ...(trackerKey === null ? {} : { tracker_api_key: trackerKey }),
    ...(ntfy === undefined ? {} : { ntfy_url: ntfy }),
  };
}

async function templateFields(command: CommandRun): Promise<TemplateFields> {
  const { id, words, project, projectId } = command;
  const repo = await originUrl(project);
  return {
    name: id.toLowerCase().replaceAll("_", "-"),
    task: id,
    run: runStamp(new Date()),
    project: project.name,
    projectId,
    repo,
    image: BOX_IMAGE,
    cmd: words.map(shellWord).join(" "),
  };
}

/** Two commands of one task must not share its volume, as tenyard `task/run.sh` refuses too. */
async function ensureIdle(cluster: Cluster, id: TaskId): Promise<void> {
  const jobs = await kubernetes.listJobs(cluster, `task=${id}`);
  const active = jobs.filter((job) => job.active > 0).map((job) => job.name);
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
