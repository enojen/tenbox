import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import path from "node:path";
import { makeTempProject, type TempProject } from "../../test/tempProject.ts";
import { env } from "../env.ts";
import { files } from "../files.ts";
import { claudeSessions, projectDir } from "./sessionFiles.ts";

const CWD = "/home/me/wt/my_app.v2/T-1";
const STARTED_MS = Date.parse("2026-01-01T00:00:00.000Z");
const DURATION_MS = 90_000;
const AGENT_DURATION_MS = 42_400;
const MARKER = "SECRET-MARKER";

let project: TempProject;
let sessionDir: string;

beforeEach(async () => {
  project = await makeTempProject({});
  sessionDir = path.join(projectDir(env().claudeDir, CWD), "session-1");
});

afterEach(async () => {
  await project.remove();
});

const usage = (input: number, output: number, write: number, read: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: write,
  cache_read_input_tokens: read,
});

const assistant = (id: string, tokens: ReturnType<typeof usage>) =>
  JSON.stringify({ type: "assistant", message: { id, usage: tokens, content: MARKER } });

/** Message m1 is on two lines (streaming: the last line has the final output count). */
async function writeTranscript(): Promise<void> {
  const lines = [
    JSON.stringify({ type: "user", message: { content: MARKER } }),
    assistant("m1", usage(10, 8, 5, 40)),
    assistant("m1", usage(10, 300, 5, 40)),
    "{broken line",
    assistant("m2", usage(20, 100, 2, 50)),
  ];
  const transcript = path.join(sessionDir, "subagents", "workflows", "wf_1", "agent-a1.jsonl");
  await files.write(transcript, `${lines.join("\n")}\n`);
}

async function writeRun(): Promise<void> {
  await writeTranscript();
  const run = {
    workflowName: "tenbox-build",
    startTime: STARTED_MS,
    durationMs: DURATION_MS,
    script: MARKER,
    result: { attention: [MARKER] },
    workflowProgress: [
      { type: "workflow_phase", title: "Build" },
      {
        type: "workflow_agent",
        label: "round 1: 01",
        phaseTitle: "Build",
        agentId: "a1",
        agentType: "worker",
        model: "claude-sonnet-5-5",
        startedAt: STARTED_MS,
        durationMs: AGENT_DURATION_MS,
        tokens: 77654,
        toolCalls: 14,
        promptPreview: MARKER,
      },
      { type: "workflow_agent", label: "round 1: checks", agentId: "a2" },
    ],
  };
  await files.write(path.join(sessionDir, "workflows", "wf_1.json"), JSON.stringify(run));
  await files.write(path.join(sessionDir, "workflows", "wf_broken.json"), "{not json");
}

test("the project directory turns every non-alphanumeric char into -", () => {
  expect(projectDir("/c", CWD)).toBe(path.join("/c", "projects", "-home-me-wt-my-app-v2-T-1"));
});

test("without a session directory there are no runs", async () => {
  const runs = await claudeSessions.listRuns(CWD);
  expect(runs).toBeNull();
});

test("reads a run with its agents and their usage, without prompt or result text", async () => {
  await writeRun();
  const runs = await claudeSessions.listRuns(CWD);
  expect(runs).toHaveLength(1);
  expect(runs?.[0]).toMatchObject({
    workflow: "tenbox-build",
    started: "2026-01-01T00:00:00.000Z",
    ended: "2026-01-01T00:01:30.000Z",
    durationMs: DURATION_MS,
  });
  expect(runs?.[0]?.agents).toEqual([
    {
      workflow: "tenbox-build",
      label: "round 1: 01",
      phase: "Build",
      role: "worker",
      model: "claude-sonnet-5-5",
      started: "2026-01-01T00:00:00.000Z",
      seconds: 42,
      tokens: 77654,
      tool_calls: 14,
      round: 1,
      calls: 2,
      input: 30,
      output: 400,
      cache_write: 7,
      cache_read: 90,
    },
    {
      workflow: "tenbox-build",
      label: "round 1: checks",
      phase: null,
      role: null,
      model: null,
      started: null,
      seconds: null,
      tokens: null,
      tool_calls: null,
      round: 1,
      calls: null,
      input: null,
      output: null,
      cache_write: null,
      cache_read: null,
    },
  ]);
  expect(JSON.stringify(runs?.[0]?.agents)).not.toContain(MARKER);
});

interface RunFileFields {
  session: string;
  runId: string;
  workflowName: string;
  startTime: number;
}

async function writeRunFile(fields: RunFileFields): Promise<void> {
  const { session, runId, workflowName, startTime } = fields;
  const dir = path.join(projectDir(env().claudeDir, CWD), session, "workflows");
  const scriptPath = path.join(dir, "scripts", `${workflowName}-${runId}.js`);
  const run = { runId, workflowName, startTime, scriptPath, args: `args of ${runId}` };
  await files.write(path.join(dir, `${runId}.json`), JSON.stringify(run));
}

test("the last run of a workflow is the newest one, with its session folder", async () => {
  await writeRunFile({
    session: "s-1",
    runId: "wf_old",
    workflowName: "tenbox-build",
    startTime: 1,
  });
  await writeRunFile({
    session: "s-2",
    runId: "wf_new",
    workflowName: "tenbox-build",
    startTime: 3,
  });
  await writeRunFile({
    session: "s-3",
    runId: "wf_plan",
    workflowName: "tenbox-plan",
    startTime: 5,
  });
  await files.write(
    path.join(projectDir(env().claudeDir, CWD), "s-4", "workflows", "wf_x.json"),
    "{",
  );
  const run = await claudeSessions.findLastRun(CWD, "tenbox-build");
  expect(run).toEqual({
    runId: "wf_new",
    scriptPath: path.join(
      projectDir(env().claudeDir, CWD),
      "s-2",
      "workflows",
      "scripts",
      "tenbox-build-wf_new.js",
    ),
    args: "args of wf_new",
    session: "s-2",
  });
});

test("without a run of the workflow there is no last run", async () => {
  await writeRunFile({
    session: "s-1",
    runId: "wf_plan",
    workflowName: "tenbox-plan",
    startTime: 1,
  });
  const run = await claudeSessions.findLastRun(CWD, "tenbox-build");
  const missing = await claudeSessions.findLastRun("/no/such/dir", "tenbox-build");
  expect(run).toBeNull();
  expect(missing).toBeNull();
});

interface UnfinishedAgent {
  id: string;
  label: string;
  role: string;
  model: string;
  first: string;
  last: string;
}

async function writeUnfinishedRun(runId: string, agents: UnfinishedAgent[]): Promise<void> {
  const transcripts = path.join(sessionDir, "subagents", "workflows", runId);
  const started = agents.map((a) =>
    JSON.stringify({ type: "started", agentId: a.id, label: a.label }),
  );
  // A second line of the same agent and a line of another type are not new agents.
  const journal = [...started, started[0], JSON.stringify({ type: "result", agentId: "a1" })];
  await files.write(path.join(transcripts, "journal.jsonl"), `${journal.join("\n")}\n`);
  for (const agent of agents) {
    const meta = { agentType: agent.role, description: MARKER };
    await files.write(path.join(transcripts, `agent-${agent.id}.meta.json`), JSON.stringify(meta));
    const lines = [
      JSON.stringify({ type: "user", timestamp: agent.first, message: { content: MARKER } }),
      JSON.stringify({
        type: "assistant",
        timestamp: agent.last,
        message: { id: `m-${agent.id}`, model: agent.model, usage: usage(1, 2, 3, 4) },
      }),
    ];
    await files.write(path.join(transcripts, `agent-${agent.id}.jsonl`), `${lines.join("\n")}\n`);
  }
  const script = path.join(sessionDir, "workflows", "scripts", `tenbox-build-${runId}.js`);
  await files.write(script, MARKER);
}

const UNFINISHED: UnfinishedAgent[] = [
  {
    id: "a1",
    label: "round 1: 01",
    role: "worker",
    model: "claude-sonnet-5-5",
    first: "2026-02-01T00:00:00.000Z",
    last: "2026-02-01T00:02:00.000Z",
  },
  {
    id: "a2",
    label: "round 1: checks",
    role: "runner",
    model: "claude-haiku-4-5",
    first: "2026-02-01T00:03:00.000Z",
    last: "2026-02-01T00:04:30.000Z",
  },
];

test("a run dir with no run file is an unfinished run read from its journal and transcripts", async () => {
  await writeUnfinishedRun("wf_2", UNFINISHED);
  const runs = await claudeSessions.listRuns(CWD);
  expect(runs).toHaveLength(1);
  expect(runs?.[0]).toMatchObject({
    workflow: "tenbox-build",
    started: "2026-02-01T00:00:00.000Z",
    ended: "2026-02-01T00:04:30.000Z",
    durationMs: 270_000,
    finished: false,
  });
  expect(runs?.[0]?.agents).toEqual([
    {
      workflow: "tenbox-build",
      label: "round 1: 01",
      phase: null,
      role: "worker",
      model: "claude-sonnet-5-5",
      started: "2026-02-01T00:00:00.000Z",
      seconds: 120,
      tokens: null,
      tool_calls: null,
      round: 1,
      calls: 1,
      input: 1,
      output: 2,
      cache_write: 3,
      cache_read: 4,
    },
    expect.objectContaining({ role: "runner", model: "claude-haiku-4-5", seconds: 90 }),
  ]);
  expect(JSON.stringify(runs)).not.toContain(MARKER);
});

test("a run dir whose run file exists is read once, as finished", async () => {
  await writeRun();
  const runs = await claudeSessions.listRuns(CWD);
  expect(runs).toHaveLength(1);
  expect(runs?.[0]?.finished).toBe(true);
});

test("an unfinished run without its script or without a timestamp is skipped", async () => {
  await writeUnfinishedRun("wf_2", UNFINISHED);
  await files.remove(path.join(sessionDir, "workflows", "scripts", "tenbox-build-wf_2.js"));
  await writeUnfinishedRun("wf_3", []);
  const runs = await claudeSessions.listRuns(CWD);
  expect(runs).toEqual([]);
});

const FIXTURE_2_1_303 = path.join(import.meta.dir, "fixtures", "claude-2.1.303", "session-1");

test("a run file without workflow_agent entries (Claude Code 2.1.303) gets its agents from the run dir", async () => {
  await cp(FIXTURE_2_1_303, sessionDir, { recursive: true });
  const runs = await claudeSessions.listRuns(CWD);
  expect(runs).toHaveLength(1);
  expect(runs?.[0]).toMatchObject({ workflow: "tenbox-plan", finished: true, durationMs: 103078 });
  const agents = runs?.[0]?.agents ?? [];
  expect(agents.map((agent) => [agent.label, agent.role])).toEqual([
    ["plan", "planner"],
    ["record plan", "runner"],
  ]);
  for (const agent of agents) {
    expect(agent.model).toStartWith("claude-");
    expect(agent.output).toBeGreaterThan(0);
  }
  expect(JSON.stringify(runs)).not.toContain("TEN-426");
});
