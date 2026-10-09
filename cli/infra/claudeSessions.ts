import path from "node:path";
import type { RunAgent, WorkflowRun } from "../../domain/runs.ts";
import { isPlainObject, MS_PER_SECOND, parseObject } from "../../domain/utils.ts";
import { env } from "./env.ts";
import { files } from "./files.ts";

/*
 * Claude Code's session files, the only place that knows their format (not a public API).
 * `<claudeDir>/projects/<cwd>/<session>/workflows/wf_*.json` holds one workflow run with its
 * agents. Prompts and result text are never returned.
 */
export const claudeSessions = { listRuns };

type Json = Record<string, unknown>;

const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;
const RUN_FILE = /^wf_.+\.json$/;
const AGENT_TYPE = "workflow_agent";

/** Claude Code's rule: every non-alphanumeric char of the working directory becomes `-`. */
export const projectDir = (claudeDir: string, cwd: string): string =>
  path.join(claudeDir, "projects", cwd.replace(NON_ALPHANUMERIC, "-"));

/** Every finished workflow run started in `cwd`; null when `cwd` has no session files. */
async function listRuns(cwd: string): Promise<WorkflowRun[] | null> {
  const dir = projectDir(env().claudeDir, cwd);
  const exists = await files.isDir(dir);
  if (!exists) return null;
  const runFiles = await listRunFiles(dir);
  const runs: WorkflowRun[] = [];
  for (const runFile of runFiles) {
    const run = await readRun(runFile);
    if (run !== null) runs.push(run);
  }
  return runs;
}

/** The `workflows/wf_*.json` files of every session in `dir`. */
async function listRunFiles(dir: string): Promise<string[]> {
  const sessions = await files.list(dir);
  const runFiles: string[] = [];
  for (const session of sessions) {
    const workflowsDir = path.join(dir, session, "workflows");
    const names = await files.list(workflowsDir);
    const runs = names.filter((name) => RUN_FILE.test(name));
    runFiles.push(...runs.map((name) => path.join(workflowsDir, name)));
  }
  return runFiles;
}

/** Null when the file is not a finished run. */
async function readRun(file: string): Promise<WorkflowRun | null> {
  const json = await readJson(file);
  if (json === null) return null;
  const { workflowName, startTime, durationMs } = json;
  if (typeof workflowName !== "string") return null;
  if (typeof startTime !== "number" || typeof durationMs !== "number") return null;
  const progress = Array.isArray(json.workflowProgress) ? json.workflowProgress : [];
  const agents = progress.filter(isAgentEntry).map((entry) => toAgent(workflowName, entry));
  return {
    workflow: workflowName,
    started: isoTime(startTime),
    ended: isoTime(startTime + durationMs),
    durationMs,
    agents,
  };
}

function toAgent(workflow: string, entry: Json): RunAgent {
  const { startedAt, durationMs } = entry;
  return {
    workflow,
    label: text(entry.label),
    phase: text(entry.phaseTitle),
    role: text(entry.agentType),
    model: text(entry.model),
    started: typeof startedAt === "number" ? isoTime(startedAt) : null,
    seconds: typeof durationMs === "number" ? Math.round(durationMs / MS_PER_SECOND) : null,
    tokens: count(entry.tokens),
    tool_calls: count(entry.toolCalls),
  };
}

const isAgentEntry = (entry: unknown): entry is Json =>
  isPlainObject(entry) && entry.type === AGENT_TYPE;

const count = (value: unknown): number | null => (typeof value === "number" ? value : null);

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const isoTime = (ms: number): string => new Date(ms).toISOString();

async function readJson(file: string): Promise<Json | null> {
  const content = await files.read(file);
  return content === null ? null : parseObject(content);
}
