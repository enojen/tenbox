import path from "node:path";
import { loginExpiredError, machineBusyError, noLoginError } from "../../domain/errors/tools.ts";
import { usageError } from "../../domain/errors/usage.ts";
import { type TaskId, taskId } from "../../domain/ids.ts";
import { MACHINE_KIND, type Manifest } from "../../domain/manifest.ts";
import type { Project } from "../../domain/project.ts";
import { claudeCredentials } from "../infra/claude/credentials.ts";
import { env } from "../infra/env.ts";
import { gh, type WorkflowFields, type WorkflowRunRow } from "../infra/gh.ts";
import { git } from "../infra/git.ts";
import { type Cluster, type Job, kubernetes, type TemplateFields } from "../infra/kubernetes.ts";
import { projects } from "./projects.ts";

/** The workflow in the tenbox repo that runs a task's command on a machine. */
const WORKFLOW = "machine.yml";
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
  url: string | null;
}

/** One Job of the cluster in the row shape of a `machine.yml` run. */
interface JobRow {
  id: string;
  title: string;
  status: "in_progress" | "completed";
  conclusion: "success" | "failure" | null;
  url: string;
  created: string;
}

export type MachineRunRow = WorkflowRunRow | JobRow;

/** Tenbox commands run as a Job on the cluster, or as a GitHub workflow on a task's machine. */
export const machines = { run, list };

/** The command after `--`, checked: only the flags of its command. */
interface ParsedWords {
  cmd: MachineCommand;
  title: string | null;
  force: boolean;
}

/** A checked command of the task and the project it runs in. */
interface CommandRun {
  id: TaskId;
  words: string[];
  parsed: ParsedWords;
  project: Project;
  manifest: Manifest;
}

/** Refuses before `gh` or the cluster is called when the command is not allowed or the login is gone. */
async function run(input: MachineRunInput): Promise<MachineRunResult> {
  const { id, words } = input;
  const parsed = parseWords(input);
  await ensureLogin();
  const { project, manifest } = await projects.get(env().cwd);
  const command = { id, words, parsed, project, manifest };
  const url = await (manifest.machine.kind === MACHINE_KIND.hetzner
    ? runWorkflow(command)
    : runJob(command));
  return { task: id, cmd: parsed.cmd, url };
}

async function list(): Promise<MachineRunRow[]> {
  const { manifest } = await projects.get(env().cwd);
  if (manifest.machine.kind === MACHINE_KIND.hetzner) {
    return gh.listRuns(env().tenboxRoot, WORKFLOW);
  }
  const cluster = await kubernetes.readCluster(env().kubeconfig);
  const jobs = await kubernetes.listJobs(cluster, TENYARD_SELECTOR);
  return jobs.map(toRow);
}

function toRow(job: Job): JobRow {
  const row = { id: job.name, title: job.cmd, url: job.url, created: job.created };
  if (job.succeeded > 0) return { ...row, status: "completed", conclusion: "success" };
  if (job.failed > 0) return { ...row, status: "completed", conclusion: "failure" };
  return { ...row, status: "in_progress", conclusion: null };
}

function parseWords(input: MachineRunInput): ParsedWords {
  const [tool, cmd, id, ...flags] = input.words;
  const command = MACHINE_COMMANDS.find((c) => c === cmd);
  if (tool !== "tenbox" || command === undefined) throw usageError(`usage: ${USAGE}`);
  if (id === undefined || taskId(id) !== input.id) throw usageError(`usage: ${USAGE}`);
  if (command === "start") return { cmd: command, title: startTitle(flags), force: false };
  if (command === "close") return { cmd: command, title: null, force: closeForce(flags) };
  if (flags.length > 0) throw usageError(`usage: ${USAGE}`);
  return { cmd: command, title: null, force: false };
}

function startTitle(flags: string[]): string | null {
  const [flag, title, ...rest] = flags;
  if (flag === undefined) return null;
  if (flag !== "--title" || title === undefined || rest.length > 0) {
    throw usageError(`usage: ${USAGE}`);
  }
  return title;
}

function closeForce(flags: string[]): boolean {
  if (flags.length === 0) return false;
  if (flags.length === 1 && flags[0] === "--force") return true;
  throw usageError(`usage: ${USAGE}`);
}

/** The refresh token must still be valid: the machine takes its login from the same file. */
async function ensureLogin(): Promise<void> {
  const expiry = await claudeCredentials.findRefreshExpiry();
  if (expiry === null) throw noLoginError(claudeCredentials.file());
  if (expiry <= Date.now()) throw loginExpiredError(new Date(expiry));
}

async function runWorkflow(command: CommandRun): Promise<string | null> {
  const { id, parsed } = command;
  const extra = await workflowFields(command);
  const fields = { task: id, cmd: parsed.cmd, ...extra };
  return gh.runWorkflow({ dir: env().tenboxRoot, workflow: WORKFLOW, fields });
}

/** `start` names the project and its origin; `close --force` adds `force`. */
async function workflowFields(command: CommandRun): Promise<WorkflowFields> {
  const { parsed, project } = command;
  if (parsed.force) return { force: "true" };
  if (parsed.cmd !== "start") return {};
  const repo = await originUrl(project);
  return { project: project.name, repo, ...(parsed.title === null ? {} : { title: parsed.title }) };
}

/** Every Job gets the project and its origin: the box clones the project on a new volume. */
async function runJob(command: CommandRun): Promise<string> {
  const { id, manifest } = command;
  const cluster = await kubernetes.readCluster(env().kubeconfig);
  const fields = await templateFields(command);
  const dir = homePath(manifest.machine.template);
  const volume = await kubernetes.readTemplate({ file: path.join(dir, "pvc.yaml"), fields });
  const job = await kubernetes.readTemplate({ file: path.join(dir, "job.yaml"), fields });
  await ensureIdle(cluster, id);
  await kubernetes.ensureVolume({ cluster, object: volume });
  return kubernetes.createJob({ cluster, object: job });
}

async function templateFields(command: CommandRun): Promise<TemplateFields> {
  const { id, words, project } = command;
  const repo = await originUrl(project);
  return {
    name: id.toLowerCase().replaceAll("_", "-"),
    task: id,
    run: runStamp(new Date()),
    project: project.name,
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

/** A token in the origin URL would land in the workflow inputs, the bucket or the Job. */
function withoutUserinfo(url: string): string {
  if (!URL.canParse(url)) return url;
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  return parsed.href;
}
