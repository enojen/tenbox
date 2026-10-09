import { afterEach, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { claudeSessions, projectDir } from "./claudeSessions.ts";
import { env } from "./env.ts";
import { files } from "./files.ts";

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

async function writeRun(): Promise<void> {
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

test("reads a run with its agents, without prompt or result text", async () => {
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
    },
  ]);
  expect(JSON.stringify(runs?.[0]?.agents)).not.toContain(MARKER);
});
