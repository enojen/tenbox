import path from "node:path";
import { type RunAgent, roundOfLabel, type Usage, type WorkflowRun } from "../../../domain/runs.ts";
import { isPlainObject, MS_PER_SECOND, parseObject } from "../../../domain/utils.ts";
import { env } from "../env.ts";
import { files } from "../files.ts";
import { readUsage } from "./transcripts.ts";

/*
 * Claude Code's session files, the only place that knows their format (not a public API).
 * `<claudeDir>/projects/<cwd>/<session>/workflows/wf_*.json` holds one workflow run with its
 * agents. The tokens come from `<session>/subagents/workflows/<run>/agent-<agentId>.jsonl`.
 * Prompts and result text are never returned.
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
  const transcripts = transcriptDir(file);
  const agents: RunAgent[] = [];
  for (const entry of progress.filter(isAgentEntry)) {
    const agent = await toAgent({ workflow: workflowName, entry, transcripts });
    agents.push(agent);
  }
  return {
    workflow: workflowName,
    started: isoTime(startTime),
    ended: isoTime(startTime + durationMs),
    durationMs,
    agents,
  };
}

/** `<session>/subagents/workflows/<run>`, for the run file `<session>/workflows/<run>.json`. */
function transcriptDir(runFile: string): string {
  const session = path.dirname(path.dirname(runFile));
  return path.join(session, "subagents", "workflows", path.basename(runFile, ".json"));
}

interface AgentSource {
  workflow: string;
  entry: Json;
  transcripts: string;
}

async function toAgent(source: AgentSource): Promise<RunAgent> {
  const { workflow, entry, transcripts } = source;
  const { startedAt, durationMs, agentId } = entry;
  const label = text(entry.label);
  const usage = await readAgentUsage(transcripts, agentId);
  return {
    workflow,
    label,
    phase: text(entry.phaseTitle),
    role: text(entry.agentType),
    model: text(entry.model),
    started: typeof startedAt === "number" ? isoTime(startedAt) : null,
    seconds: typeof durationMs === "number" ? Math.round(durationMs / MS_PER_SECOND) : null,
    tokens: count(entry.tokens),
    tool_calls: count(entry.toolCalls),
    round: roundOfLabel(label),
    calls: usage?.calls ?? null,
    input: usage?.input ?? null,
    output: usage?.output ?? null,
    cache_write: usage?.cache_write ?? null,
    cache_read: usage?.cache_read ?? null,
  };
}

function readAgentUsage(transcripts: string, agentId: unknown): Promise<Usage | null> {
  if (typeof agentId !== "string") return Promise.resolve(null);
  return readUsage(path.join(transcripts, `agent-${agentId}.jsonl`));
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
