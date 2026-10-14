import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { projectDir } from "../infra/claude/sessionFiles.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const MS_PER_MINUTE = 60_000;
const START_MS = Date.now() + MS_PER_MINUTE;

let project: TempProject;
let taskWorktree: string;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  taskWorktree = path.join(project.wtRoot, "demo", "T-1");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
});

afterEach(async () => {
  await project.remove();
});

const stats = () => tenbox(["stats", "T-1"], project.mainDir);

interface Message {
  id: string;
  input: number;
  output: number;
}

interface AgentFixture {
  label: string;
  role: string;
  model: string;
  minute: number;
  messages: Message[];
}

interface RunFixture {
  name: string;
  workflow: string;
  minute: number;
  agents: AgentFixture[];
}

const assistantLine = (message: Message) =>
  JSON.stringify({
    type: "assistant",
    message: {
      id: message.id,
      usage: {
        input_tokens: message.input,
        output_tokens: message.output,
        cache_creation_input_tokens: 1,
        cache_read_input_tokens: 2,
      },
    },
  });

/** A run in the task worktree's session files; each agent works for one minute. */
async function writeRun(run: RunFixture): Promise<void> {
  const sessionDir = path.join(projectDir(env().claudeDir, taskWorktree), "session-1");
  const progress = run.agents.map((agent, i) => ({
    type: "workflow_agent",
    label: agent.label,
    agentId: `${run.name}-${i}`,
    agentType: agent.role,
    model: agent.model,
    startedAt: START_MS + agent.minute * MS_PER_MINUTE,
    durationMs: MS_PER_MINUTE,
  }));
  const record = {
    workflowName: run.workflow,
    startTime: START_MS + run.minute * MS_PER_MINUTE,
    durationMs: MS_PER_MINUTE,
    workflowProgress: progress,
  };
  await files.write(path.join(sessionDir, "workflows", `${run.name}.json`), JSON.stringify(record));
  for (const [i, agent] of run.agents.entries()) {
    // The first message is on two lines, as Claude Code writes a streamed message.
    const doubled = agent.messages.flatMap((one, n) => (n === 0 ? [one, one] : [one]));
    const lines = doubled.map(assistantLine);
    const transcript = path.join(
      sessionDir,
      "subagents",
      "workflows",
      run.name,
      `agent-${run.name}-${i}.jsonl`,
    );
    await files.write(transcript, `${lines.join("\n")}\n`);
  }
}

const message = (id: string, output: number): Message => ({ id, input: 10, output });

const buildRun = (name: string, minute: number): RunFixture => ({
  name,
  workflow: "tenbox-build",
  minute,
  agents: [
    {
      label: "round 1: 01",
      role: "worker",
      model: "sonnet",
      minute,
      messages: [message(`${name}-a`, 100), message(`${name}-b`, 50)],
    },
    {
      label: "round 1: checks",
      role: "runner",
      model: "haiku",
      minute: minute + 2,
      messages: [message(`${name}-c`, 7)],
    },
    {
      label: "record build",
      role: "runner",
      model: "haiku",
      minute: minute + 5,
      messages: [message(`${name}-d`, 3)],
    },
  ],
});

describe("tenbox stats", () => {
  test("sums the transcripts per round, role and model, each message id once", async () => {
    await writeRun(buildRun("wf_1", 0));
    const run = await stats();
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({ ok: true, task: "T-1", source: "sessions" });
    expect(run.json.rounds).toEqual([
      { round: 1, minutes: 3, calls: 3, input: 30, output: 157, cache_write: 3, cache_read: 6 },
      { round: null, minutes: 1, calls: 1, input: 10, output: 3, cache_write: 1, cache_read: 2 },
    ]);
    expect(run.json.roles).toEqual([
      { role: "worker", calls: 2, input: 20, output: 150, cache_write: 2, cache_read: 4 },
      { role: "runner", calls: 2, input: 20, output: 10, cache_write: 2, cache_read: 4 },
    ]);
    expect(run.json.models).toEqual([
      { model: "sonnet", calls: 2, input: 20, output: 150, cache_write: 2, cache_read: 4 },
      { model: "haiku", calls: 2, input: 20, output: 10, cache_write: 2, cache_read: 4 },
    ]);
  });

  test("the rounds of a second build run continue after the first run's", async () => {
    const first = buildRun("wf_1", 0);
    const extra: AgentFixture = {
      label: "round 3: 01",
      role: "worker",
      model: "sonnet",
      minute: 8,
      messages: [message("wf_1-e", 5)],
    };
    await writeRun({ ...first, agents: [...first.agents, extra] });
    await writeRun(buildRun("wf_2", 20));
    const run = await stats();
    expect(run.json.rounds).toMatchObject([
      { round: 1 },
      { round: 3 },
      { round: 4 },
      { round: null },
    ]);
  });

  test("counts an unfinished run in the round after the finished run, and lists both runs", async () => {
    await writeRun(buildRun("wf_1", 0));
    const sessionDir = path.join(projectDir(env().claudeDir, taskWorktree), "session-1");
    const runDir = path.join(sessionDir, "subagents", "workflows", "wf_2");
    const iso = (minute: number) => new Date(START_MS + minute * MS_PER_MINUTE).toISOString();
    const agents = [
      { id: "u1", label: "round 1: 01", role: "worker", model: "opus", first: 20, last: 22 },
      { id: "u2", label: "round 1: checks", role: "runner", model: "haiku", first: 23, last: 24 },
    ];
    const started = agents.map((a) => ({ type: "started", agentId: a.id, label: a.label }));
    await files.write(
      path.join(runDir, "journal.jsonl"),
      started.map((line) => JSON.stringify(line)).join("\n"),
    );
    for (const agent of agents) {
      const meta = { agentType: agent.role };
      await files.write(path.join(runDir, `agent-${agent.id}.meta.json`), JSON.stringify(meta));
      const lines = [
        JSON.stringify({ type: "user", timestamp: iso(agent.first) }),
        JSON.stringify({
          type: "assistant",
          timestamp: iso(agent.last),
          message: {
            id: agent.id,
            model: agent.model,
            usage: { input_tokens: 1, output_tokens: 5 },
          },
        }),
      ];
      await files.write(path.join(runDir, `agent-${agent.id}.jsonl`), lines.join("\n"));
    }
    const script = path.join(sessionDir, "workflows", "scripts", "tenbox-build-wf_2.js");
    await files.write(script, "");
    const run = await stats();
    expect(run.json.source).toBe("sessions");
    expect(run.json.rounds).toMatchObject([
      { round: 1, minutes: 3, calls: 3 },
      { round: 2, minutes: 4, calls: 2, output: 10 },
      { round: null },
    ]);
    expect(run.json.roles).toMatchObject([{ role: "worker" }, { role: "runner" }]);
    expect(run.json.models).toMatchObject([
      { model: "sonnet" },
      { model: "haiku" },
      { model: "opus" },
    ]);
    expect(run.json.runs).toEqual([
      { workflow: "tenbox-build", started: iso(0), finished: true },
      { workflow: "tenbox-build", started: iso(20), finished: false },
    ]);
  });

  test("after tenbox close it reads stats.json and prints the same numbers", async () => {
    await writeRun(buildRun("wf_1", 0));
    const before = await stats();
    const closed = await tenbox(["close", "T-1", "--force"], project.mainDir);
    expect(closed.json.ok).toBe(true);
    const after = await stats();
    expect(after.json.source).toBe("stats.json");
    expect(after.json).toEqual({ ...before.json, source: "stats.json" });
  });

  test("without stats.json and session files it fails with no-stats", async () => {
    const run = await stats();
    expect([run.code, run.json.ok, run.json.code]).toEqual([1, false, "no-stats"]);
  });

  describe("a stats.json of schema 4, written before the usage fields", () => {
    const writeOld = () =>
      files.writeJson(path.join(taskWorktree, ".tenbox", "stats.json"), { schema: 4, agents: [] });

    test("is skipped for the session files while the worktree has them", async () => {
      await writeOld();
      await writeRun(buildRun("wf_1", 0));
      const run = await stats();
      expect([run.code, run.json.source]).toEqual([0, "sessions"]);
    });

    test("without session files it fails with old-stats, not no-stats", async () => {
      await writeOld();
      const run = await stats();
      expect([run.code, run.json.code]).toEqual([1, "old-stats"]);
    });
  });
});
