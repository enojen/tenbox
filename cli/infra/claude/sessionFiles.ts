import path from "node:path";
import { z } from "zod";
import { type RunAgent, roundOfLabel, type WorkflowRun } from "../../../domain/runs.ts";
import { durations } from "../../../domain/utils.ts";
import { env } from "../env.ts";
import { files } from "../files.ts";
import { claudeFiles } from "./claudeFiles.ts";
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

const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;
const RUN_FILE = /^wf_.+\.json$/;
const AGENT_TYPE = "workflow_agent";
const STARTED_TYPE = "started";

/** One agent of a run file's `workflowProgress`; its times and counts are missing while it runs. */
const AgentEntrySchema = z.object({
  type: z.literal(AGENT_TYPE),
  agentId: z.string(),
  label: z.string(),
  model: z.string(),
  startedAt: z.number(),
  phaseTitle: z.string().optional(),
  agentType: z.string().optional(),
  durationMs: z.number().optional(),
  tokens: z.number().optional(),
  toolCalls: z.number().optional(),
});

type AgentEntry = z.infer<typeof AgentEntrySchema>;

/** Any other entry, such as a `workflow_phase`: not read. */
const OtherEntrySchema = z.object({ type: z.string().refine((type) => type !== AGENT_TYPE) });

const ProgressEntrySchema = z.union([AgentEntrySchema, OtherEntrySchema]);

type ProgressEntry = z.infer<typeof ProgressEntrySchema>;

/** `workflows/wf_*.json`; `runId`, `scriptPath` and `args` are missing in Claude Code 2.1.303. */
const RunFileSchema = z.object({
  workflowName: z.string(),
  startTime: z.number(),
  durationMs: z.number(),
  runId: z.string().optional(),
  scriptPath: z.string().optional(),
  args: z.unknown().optional(),
  workflowProgress: z.array(ProgressEntrySchema),
});

type RunFile = z.infer<typeof RunFileSchema>;

/** `agent-<agentId>.meta.json` of a run dir: only the role is read. */
const AgentMetaSchema = z.object({ agentType: z.string() });

/** A `started` line of a run dir's `journal.jsonl`: one per agent, sometimes twice. */
const StartedLineSchema = z.object({
  type: z.literal(STARTED_TYPE),
  agentId: z.string(),
  label: z.string(),
});

/** Any other journal line, such as `result`: not read. */
const OtherLineSchema = z.object({ type: z.string().refine((type) => type !== STARTED_TYPE) });

const JournalLineSchema = z.union([StartedLineSchema, OtherLineSchema]);

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
    const json = await claudeFiles.find(RunFileSchema, runFile);
    if (json?.workflowName !== workflow) continue;
    const run = toResumable(json, runFile);
    if (run === null || json.startTime <= lastStart) continue;
    last = run;
    lastStart = json.startTime;
  }
  return last;
}

/** Null when the run file has no `runId` or `scriptPath`. */
function toResumable(json: RunFile, runFile: string): ResumableRun | null {
  const { runId, scriptPath, args } = json;
  if (runId === undefined || scriptPath === undefined) return null;
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

/** Null when the run file is missing or does not fit. */
async function readRun(file: string): Promise<WorkflowRun | null> {
  const json = await claudeFiles.find(RunFileSchema, file);
  if (json === null) return null;
  const { workflowName, startTime, durationMs } = json;
  const transcripts = transcriptDir(file);
  const agents: RunAgent[] = [];
  for (const entry of json.workflowProgress.filter(isAgentEntry)) {
    const agent = await toFinishedAgent({ workflow: workflowName, entry, transcripts });
    agents.push(agent);
  }
  // Claude Code 2.1.303 writes no agent entries: the run dir has them.
  if (agents.length === 0) {
    const fromDir = await readRunDirAgents({ workflow: workflowName, runDir: transcripts });
    agents.push(...(fromDir?.agents ?? []));
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
  entry: AgentEntry;
  transcripts: string;
}

async function toFinishedAgent(source: AgentSource): Promise<RunAgent> {
  const { workflow, entry, transcripts } = source;
  const { startedAt, durationMs, agentId, label } = entry;
  const transcript = await readAgentTranscript(transcripts, agentId);
  const usage = transcript?.usage ?? null;
  return {
    workflow,
    label,
    phase: entry.phaseTitle ?? null,
    role: entry.agentType ?? null,
    model: entry.model,
    started: isoTime(startedAt),
    seconds: durationMs === undefined ? null : Math.round(durationMs / durations.MS_PER_SECOND),
    tokens: entry.tokens ?? null,
    tool_calls: entry.toolCalls ?? null,
    round: roundOfLabel(label),
    calls: usage?.calls ?? null,
    input: usage?.input ?? null,
    output: usage?.output ?? null,
    cache_write: usage?.cache_write ?? null,
    cache_read: usage?.cache_read ?? null,
  };
}

function readAgentTranscript(transcripts: string, agentId: string): Promise<Transcript | null> {
  return readTranscript(path.join(transcripts, `agent-${agentId}.jsonl`));
}

const isAgentEntry = (entry: ProgressEntry): entry is AgentEntry => entry.type === AGENT_TYPE;

const isoTime = (ms: number): string => new Date(ms).toISOString();

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
  if (workflow === null) return null;
  const fromDir = await readRunDirAgents({ workflow, runDir });
  if (fromDir === null) return null;
  const { agents, ends } = fromDir;
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

/** The agents of a run dir: the journal's `started` lines, the metas and the transcripts; null without a journal. */
async function readRunDirAgents(input: {
  workflow: string;
  runDir: string;
}): Promise<RunDirAgents | null> {
  const { workflow, runDir } = input;
  const journal = await claudeFiles.findLines(
    JournalLineSchema,
    path.join(runDir, "journal.jsonl"),
  );
  if (journal === null) return null;
  const result: RunDirAgents = { agents: [], ends: [] };
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

type JournalLine = z.infer<typeof JournalLineSchema>;
type StartedLine = z.infer<typeof StartedLineSchema>;

/** One entry per agent: the `started` lines of the journal, the first of each `agentId`. */
function startedAgents(journal: JournalLine[]): StartedLine[] {
  const byId = new Map<string, StartedLine>();
  for (const line of journal) {
    if (!("agentId" in line) || byId.has(line.agentId)) continue;
    byId.set(line.agentId, line);
  }
  return [...byId.values()];
}

interface UnfinishedSource {
  workflow: string;
  runDir: string;
  started: StartedLine;
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
  const metaFile = path.join(runDir, `agent-${started.agentId}.meta.json`);
  const meta = await claudeFiles.find(AgentMetaSchema, metaFile);
  const { usage } = transcript;
  const agent: RunAgent = {
    workflow,
    label: started.label,
    phase: null,
    role: meta?.agentType ?? null,
    model: transcript.model,
    started: isoTime(startMs),
    seconds: Math.round((endMs - startMs) / durations.MS_PER_SECOND),
    tokens: null,
    tool_calls: null,
    round: roundOfLabel(started.label),
    ...usage,
  };
  return { agent, endedAt: endMs };
}
