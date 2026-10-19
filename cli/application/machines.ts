import { loginExpiredError, noLoginError } from "../../domain/errors/tools.ts";
import { usageError } from "../../domain/errors/usage.ts";
import { type TaskId, taskId } from "../../domain/ids.ts";
import { claudeCredentials } from "../infra/claude/credentials.ts";
import { env } from "../infra/env.ts";
import { gh, type WorkflowFields, type WorkflowRunRow } from "../infra/gh.ts";
import { git } from "../infra/git.ts";
import { projects } from "./projects.ts";

/** The workflow in the tenbox repo that runs a task's command on a machine. */
const WORKFLOW = "machine.yml";
const MACHINE_COMMANDS = ["start", "build", "close"] as const;
type MachineCommand = (typeof MACHINE_COMMANDS)[number];

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

/** Tenbox commands run as a GitHub workflow on a task's machine. */
export const machines = { run, list };

/** Refuses before `gh` runs when the command is not allowed or the login is gone. */
async function run(input: MachineRunInput): Promise<MachineRunResult> {
  const { id } = input;
  const { cmd, flags } = parseWords(input);
  await ensureLogin();
  const extra = await commandFields({ cmd, flags });
  const fields = { task: id, cmd, ...extra };
  const url = await gh.runWorkflow({ dir: env().tenboxRoot, workflow: WORKFLOW, fields });
  return { task: id, cmd, url };
}

function list(): Promise<WorkflowRunRow[]> {
  return gh.listRuns(env().tenboxRoot, WORKFLOW);
}

interface ParsedWords {
  cmd: MachineCommand;
  flags: string[];
}

function parseWords(input: MachineRunInput): ParsedWords {
  const [tool, cmd, id, ...flags] = input.words;
  const command = MACHINE_COMMANDS.find((c) => c === cmd);
  if (tool !== "tenbox" || command === undefined) throw usageError(`usage: ${USAGE}`);
  if (id === undefined || taskId(id) !== input.id) throw usageError(`usage: ${USAGE}`);
  return { cmd: command, flags };
}

/** The refresh token must still be valid: the machine takes its login from the same file. */
async function ensureLogin(): Promise<void> {
  const expiry = await claudeCredentials.findRefreshExpiry();
  if (expiry === null) throw noLoginError(claudeCredentials.file());
  if (expiry <= Date.now()) throw loginExpiredError(new Date(expiry));
}

interface CommandFlags {
  cmd: MachineCommand;
  flags: string[];
}

function commandFields(input: CommandFlags): Promise<WorkflowFields> | WorkflowFields {
  const { cmd, flags } = input;
  if (cmd === "start") return startFields(flags);
  if (cmd === "close") return closeFields(flags);
  if (flags.length > 0) throw usageError(`usage: ${USAGE}`);
  return {};
}

function closeFields(flags: string[]): WorkflowFields {
  if (flags.length === 0) return {};
  if (flags.length === 1 && flags[0] === "--force") return { force: "true" };
  throw usageError(`usage: ${USAGE}`);
}

/** The project of the current directory and the origin of its main checkout. */
async function startFields(flags: string[]): Promise<WorkflowFields> {
  const [flag, title, ...rest] = flags;
  const hasTitle = flag === "--title" && title !== undefined;
  if ((flag !== undefined && !hasTitle) || rest.length > 0) throw usageError(`usage: ${USAGE}`);
  const { project } = await projects.get(env().cwd);
  const repo = await git.findRemoteUrl(project.mainDir);
  if (repo === null) throw usageError(`${project.name} has no git remote origin`);
  return { project: project.name, repo: withoutUserinfo(repo), ...(hasTitle ? { title } : {}) };
}

/** A token in the origin URL would land in the workflow inputs and in the bucket. */
function withoutUserinfo(url: string): string {
  if (!URL.canParse(url)) return url;
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  return parsed.href;
}
