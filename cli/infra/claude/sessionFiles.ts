import path from "node:path";
import { type RunAgent, roundOfLabel, type WorkflowRun } from "../../../domain/runs.ts";
import { isPlainObject, MS_PER_SECOND, parseObject } from "../../../domain/utils.ts";
import { env } from "../env.ts";
import { files } from "../files.ts";
import { readTranscript, type Transcript } from "./transcripts.ts";

/*
 * Claude Code's session files, the only place that knows their format (not a public API).
 * `<claudeDir>/projects/<cwd>/<session>/workflows/wf_*.json` holds one workflow run with its
 * agents. The tokens come from `<session>/subagents/workflows/<run>/agent-<agentId>.jsonl`.
 * A run whose session ended has no run file: its agents come from `<run>/journal.jsonl`, the
 * `agent-<agentId>.meta.json` and the transcripts, its workflow from the script name.
 * A run file without agent entries (Claude Code 2.1.303) reads its agents from the run dir too.
 * Prompts and result text are never returned.
 */
export const claudeSessions = { listRuns, findLastRun };

/** A workflow run that `resumeFromRunId` can continue in its session. */
export interface ResumableRun {
  runId: string;
  scriptPath: string;
  /** The run's `args`, as the workflow got them. */
  args: unknown;
  /** The full session id: the name of the session folder. */
  session: string;
}

type Json = Record<string, unknown>;

const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;
const RUN_FILE = /^wf_.+\.json$/;
const AGENT_TYPE = "workflow_agent";

/** Claude Code's rule: every non-alphanumeric char of the working directory becomes `-`. */
export const projectDir = (claudeDir: string, cwd: string): string =>
  path.join(claudeDir, "projects", cwd.replace(NON_ALPHANUMERIC, "-"));

/** Every workflow run started in `cwd`, finished or not; null when `cwd` has no session files. */
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
  const unfinished = await listUnfinishedDirs(dir);
  for (const runDir of unfinished) {
    const run = await readUnfinishedRun(runDir);
    if (run !== null) runs.push(run);
  }
  return runs;
}

/** The newest run of `workflow` started in `cwd`; null without one. */
async function findLastRun(cwd: string, workflow: string): Promise<ResumableRun | null> {
  const runFiles = await listRunFiles(projectDir(env().claudeDir, cwd));
  let last: ResumableRun | null = null;
  let lastStart = Number.NEGATIVE_INFINITY;
  for (const runFile of runFiles) {
    const json = await readJson(runFile);
    if (json?.workflowName !== workflow || typeof json.startTime !== "number") continue;
    const run = toResumable(json, runFile);
    if (run === null || json.startTime <= lastStart) continue;
    last = run;
    lastStart = json.startTime;
  }
  return last;
}

/** Null when the run file has no `runId` or `scriptPath`. */
function toResumable(json: Json, runFile: string): ResumableRun | null {
  const { runId, scriptPath, args } = json;
  if (typeof runId !== "string" || typeof scriptPath !== "string") return null;
  return { runId, scriptPath, args, session: path.basename(path.dirname(path.dirname(runFile))) };
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
    const agent = await toFinishedAgent({ workflow: workflowName, entry, transcripts });
    agents.push(agent);
  }
  // Claude Code 2.1.303 writes no agent entries: the run dir has them.
  if (agents.length === 0) {
    const fromDir = await readRunDirAgents({ workflow: workflowName, runDir: transcripts });
    agents.push(...fromDir.agents);
  }
  return {
    workflow: workflowName,
    started: isoTime(startTime),
    ended: isoTime(startTime + durationMs),
    durationMs,
    finished: true,
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

async function toFinishedAgent(source: AgentSource): Promise<RunAgent> {
  const { workflow, entry, transcripts } = source;
  const { startedAt, durationMs, agentId } = entry;
  const label = text(entry.label);
  const transcript = await readAgentTranscript(transcripts, agentId);
  const usage = transcript?.usage ?? null;
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

function readAgentTranscript(transcripts: string, agentId: unknown): Promise<Transcript | null> {
  if (typeof agentId !== "string") return Promise.resolve(null);
  return readTranscript(path.join(transcripts, `agent-${agentId}.jsonl`));
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

/** `<session>/subagents/workflows/<run>` dirs with no `<session>/workflows/<run>.json`. */
async function listUnfinishedDirs(dir: string): Promise<string[]> {
  const sessions = await files.list(dir);
  const unfinished: string[] = [];
  for (const session of sessions) {
    const dirs = await listSessionUnfinishedDirs({ dir, session });
    unfinished.push(...dirs);
  }
  return unfinished;
}

type SessionDir = { dir: string; session: string };

async function listSessionUnfinishedDirs(input: SessionDir): Promise<string[]> {
  const { dir, session } = input;
  const parent = path.join(dir, session, "subagents", "workflows");
  const unfinished: string[] = [];
  const names = await files.list(parent);
  for (const name of names) {
    const hasRunFile = await files.exists(path.join(dir, session, "workflows", `${name}.json`));
    if (!hasRunFile) unfinished.push(path.join(parent, name));
  }
  return unfinished;
}

/** Null without a script (the workflow name), a journal or any agent time. */
async function readUnfinishedRun(runDir: string): Promise<WorkflowRun | null> {
  const workflow = await findWorkflowName(runDir);
  const journal = await files.read(path.join(runDir, "journal.jsonl"));
  if (workflow === null || journal === null) return null;
  const { agents, ends } = await readRunDirAgents({ workflow, runDir });
  const starts = agents.map((agent) => Date.parse(agent.started ?? ""));
  if (starts.length === 0) return null;
  const startMs = Math.min(...starts);
  const endMs = Math.max(...ends);
  return {
    workflow,
    started: isoTime(startMs),
    ended: isoTime(endMs),
    durationMs: endMs - startMs,
    finished: false,
    agents,
  };
}

interface RunDirAgents {
  agents: RunAgent[];
  ends: number[];
}

/** The agents of a run dir: the journal's `started` lines, the metas and the transcripts. */
async function readRunDirAgents(input: {
  workflow: string;
  runDir: string;
}): Promise<RunDirAgents> {
  const { workflow, runDir } = input;
  const journal = await files.read(path.join(runDir, "journal.jsonl"));
  const result: RunDirAgents = { agents: [], ends: [] };
  if (journal === null) return result;
  for (const started of startedAgents(journal)) {
    const agent = await toUnfinishedAgent({ workflow, runDir, started });
    if (agent === null) continue;
    result.agents.push(agent.agent);
    result.ends.push(agent.endedAt);
  }
  return result;
}

/** `<workflow>` of the script `<session>/workflows/scripts/<workflow>-<run>.js`. */
async function findWorkflowName(runDir: string): Promise<string | null> {
  const runId = path.basename(runDir);
  const session = path.dirname(path.dirname(path.dirname(runDir)));
  const scripts = path.join(session, "workflows", "scripts");
  const suffix = `-${runId}.js`;
  const names = await files.list(scripts);
  const script = names.find((name) => name.endsWith(suffix));
  return script === undefined ? null : script.slice(0, -suffix.length);
}

interface StartedAgent {
  agentId: string;
  label: string | null;
}

/** One entry per agent: the `started` lines of the journal, the first of each `agentId`. */
function startedAgents(journal: string): StartedAgent[] {
  const byId = new Map<string, StartedAgent>();
  for (const line of journal.split("\n")) {
    const entry = parseObject(line);
    if (entry?.type !== "started" || typeof entry.agentId !== "string") continue;
    if (!byId.has(entry.agentId))
      byId.set(entry.agentId, { agentId: entry.agentId, label: text(entry.label) });
  }
  return [...byId.values()];
}

interface UnfinishedSource {
  workflow: string;
  runDir: string;
  started: StartedAgent;
}

interface UnfinishedAgent {
  agent: RunAgent;
  endedAt: number;
}

/** Null when the agent has no transcript time. */
async function toUnfinishedAgent(source: UnfinishedSource): Promise<UnfinishedAgent | null> {
  const { workflow, runDir, started } = source;
  const transcript = await readAgentTranscript(runDir, started.agentId);
  if (transcript === null || transcript.firstAt === null || transcript.lastAt === null) return null;
  const startMs = Date.parse(transcript.firstAt);
  const endMs = Date.parse(transcript.lastAt);
  const meta = await readJson(path.join(runDir, `agent-${started.agentId}.meta.json`));
  const { usage } = transcript;
  const agent: RunAgent = {
    workflow,
    label: started.label,
    phase: null,
    role: text(meta?.agentType),
    model: transcript.model,
    started: isoTime(startMs),
    seconds: Math.round((endMs - startMs) / MS_PER_SECOND),
    tokens: null,
    tool_calls: null,
    round: roundOfLabel(started.label),
    ...usage,
  };
  return { agent, endedAt: endMs };
}
