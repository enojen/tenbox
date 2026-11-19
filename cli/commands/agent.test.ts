import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { z } from "zod";
import { jsons } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_CONFLICT = 409;
const TENPORT_TOKEN = "tbx_SECRET";
const CHANGED = "2026-11-19T09:00:00Z";
const LOGIN = JSON.stringify({ claudeAiOauth: { accessToken: "SECRET-LOGIN" } });

/** One request the fake Tenport got. */
interface Call {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
}

interface AgentLogin {
  changed: string;
}

interface Agent {
  id: string;
  kind: string;
  name: string;
  default: boolean;
  login: AgentLogin | null;
}

const NewAgentSchema = z.object({ kind: z.string(), name: z.string() });

/** A Tenport on 127.0.0.1 that keeps agents and logs each request. */
interface FakeTenport {
  url: string;
  calls: Call[];
  agents: Agent[];
  stop(): void;
}

function startFakeTenport(): FakeTenport {
  const fake: FakeTenport = { url: "", calls: [], agents: [], stop: () => {} };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const url = new URL(request.url);
      const text = await request.text();
      const body = text === "" ? null : jsons.parse(text);
      const auth = request.headers.get("authorization");
      fake.calls.push({ method: request.method, path: url.pathname, auth, body });
      return answer(fake, request.method, url.pathname, body);
    },
  });
  fake.url = `http://127.0.0.1:${server.port}`;
  fake.stop = () => server.stop(true);
  return fake;
}

function answer(fake: FakeTenport, method: string, route: string, body: unknown): Response {
  if (method === "GET" && route === "/agents") return Response.json(fake.agents);
  if (method === "POST" && route === "/agents") return addAgent(fake, body);
  const agent = route.match(/^\/agents\/([^/]+)\/login$/)?.[1];
  if (method === "PUT" && agent !== undefined) {
    return Response.json({ agent, changed: CHANGED }, { status: HTTP_OK });
  }
  return new Response(null, { status: 404 });
}

function addAgent(fake: FakeTenport, body: unknown): Response {
  const { name, kind } = NewAgentSchema.parse(body);
  if (fake.agents.some((agent) => agent.name === name)) {
    const problem = { status: HTTP_CONFLICT, code: "agent-exists", detail: `${name} exists` };
    return Response.json({ type: "about:blank", title: "", ...problem }, { status: HTTP_CONFLICT });
  }
  const id = `a-${fake.agents.length + 1}`;
  const agent = { id, kind, name, default: fake.agents.length === 0, login: null };
  fake.agents.push(agent);
  return Response.json(agent, { status: HTTP_CREATED });
}

/** An agent the test names; the kind and login are those of a new Claude Code agent. */
interface NamedAgent {
  id: string;
  name: string;
  default: boolean;
}

const agentOf = (input: NamedAgent): Agent => ({
  ...input,
  kind: "claude-code",
  login: null,
});

let project: TempProject;
let claudeDir: string;
let env: Record<string, string>;
let tenport: FakeTenport;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  claudeDir = path.join(project.root, "claude");
  tenport = startFakeTenport();
  env = { CLAUDE_CONFIG_DIR: claudeDir, TENPORT_URL: tenport.url, TENPORT_TOKEN };
  await files.write(path.join(claudeDir, ".credentials.json"), LOGIN);
});

afterEach(async () => {
  tenport.stop();
  await project.remove();
});

const agentCommand = (args: string[]) => tenbox(["agent", ...args], project.mainDir, env);

const puts = () => tenport.calls.filter((call) => call.method === "PUT");

describe("agent add", () => {
  test("adds a claude-code agent in Tenport and prints it", async () => {
    const added = await agentCommand(["add", "personal"]);

    expect(added.code).toBe(0);
    expect(tenport.calls).toEqual([
      {
        method: "POST",
        path: "/agents",
        auth: `Bearer ${TENPORT_TOKEN}`,
        body: { kind: "claude-code", name: "personal" },
      },
    ]);
    expect(added.json).toEqual({
      ok: true,
      agent: agentOf({ id: "a-1", name: "personal", default: true }),
    });
  });

  test("a name that exists is agent-exists", async () => {
    tenport.agents.push(agentOf({ id: "a-1", name: "personal", default: true }));

    const added = await agentCommand(["add", "personal"]);

    expect(added.code).toBe(1);
    expect(added.json.code).toBe("agent-exists");
  });

  test("without a name it is a usage error", async () => {
    const added = await agentCommand(["add"]);

    expect(added.code).toBe(USAGE_EXIT);
    expect(tenport.calls).toEqual([]);
  });

  test("without TENPORT_URL it is no-tenport before any request", async () => {
    env.TENPORT_URL = "";

    const added = await agentCommand(["add", "personal"]);

    expect(added.json.code).toBe("no-tenport");
    expect(tenport.calls).toEqual([]);
  });
});

describe("agent login", () => {
  beforeEach(() => {
    tenport.agents.push(agentOf({ id: "a-1", name: "personal", default: true }));
    tenport.agents.push(agentOf({ id: "a-2", name: "work", default: false }));
  });

  test("puts the login file to the default agent and never prints it", async () => {
    const sent = await agentCommand(["login"]);

    expect(sent.code).toBe(0);
    expect(puts()).toEqual([
      {
        method: "PUT",
        path: "/agents/a-1/login",
        auth: `Bearer ${TENPORT_TOKEN}`,
        body: { value: LOGIN },
      },
    ]);
    expect(sent.json).toEqual({ ok: true, agent: "a-1", changed: CHANGED });
    expect(sent.out + sent.err).not.toContain("SECRET-LOGIN");
  });

  test("a name picks that agent", async () => {
    const sent = await agentCommand(["login", "work"]);

    expect(sent.code).toBe(0);
    expect(puts().map((call) => call.path)).toEqual(["/agents/a-2/login"]);
  });

  test("an unknown name is no-agent and puts nothing", async () => {
    const sent = await agentCommand(["login", "other"]);

    expect(sent.json.code).toBe("no-agent");
    expect(sent.json.error).toContain("tenbox agent add");
    expect(puts()).toEqual([]);
  });

  test("a user with no agent is no-agent", async () => {
    tenport.agents.length = 0;

    const sent = await agentCommand(["login"]);

    expect(sent.json.code).toBe("no-agent");
    expect(puts()).toEqual([]);
  });

  test("without the login file it is no-login before any request", async () => {
    await files.remove(path.join(claudeDir, ".credentials.json"));

    const sent = await agentCommand(["login"]);

    expect(sent.json.code).toBe("no-login");
    expect(tenport.calls).toEqual([]);
  });

  test("more than one name is a usage error", async () => {
    const sent = await agentCommand(["login", "personal", "work"]);

    expect(sent.code).toBe(USAGE_EXIT);
  });
});
