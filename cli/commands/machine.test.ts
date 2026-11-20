import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { jsons } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { tenbox } from "../test/cli.ts";
import { fakeTool } from "../test/fakeTools.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;
const TENPORT_TOKEN = "tbx_SECRET";
const PROJECT_ID = "k7f3qa";
const RUN = "task-ten-1-1118-101500";
const OLD_RUN = "task-ten-1-1118-090000";
const CREATED = "2026-11-18T10:15:00Z";
const TRACKER_KEY = "SECRET-TRACKER-KEY";
const NTFY_URL = "https://ntfy.sh/secret-topic";
const GITHUB_USER = { login: "octo", id: 42, name: "Octo Cat" };
const AUTHOR = { name: "Octo Cat", email: "42+octo@users.noreply.github.com" };
const OUTPUT = { ok: true, task: "TEN-1", approved: true };
const BOX_LOG = "tenbox-boot: cloning\ntenbox-boot: command ended with exit code 0\n";

let project: TempProject;
let claudeDir: string;
let env: Record<string, string>;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  claudeDir = path.join(project.root, "claude");
  // The tracker keys of the shell that runs the tests must not reach Tenport.
  env = { CLAUDE_CONFIG_DIR: claudeDir, CLICKUP_API_KEY: "", LINEAR_API_KEY: "" };
});

afterEach(() => project.remove());

const writeLogin = (expiresAt: number) =>
  files.write(
    path.join(claudeDir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "SECRET", refreshTokenExpiresAt: expiresAt } }),
  );

const machine = (args: string[]) => tenbox(["machine", ...args], project.mainDir, env);

/** One request the fake Tenport got. */
interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | null;
  body: unknown;
}

/** What the fake Tenport answers to one request. */
interface Answer {
  status: number;
  body?: unknown;
  retryAfter?: number;
}

type RunState = Record<string, unknown>;

/** A Tenport on 127.0.0.1 that logs each request and answers from its fields. */
interface FakeTenport {
  url: string;
  calls: Call[];
  /** The answers of `POST /runs`, one each; after them a created `RUN`. */
  posts: Answer[];
  /** The runs `GET /runs` lists, by their task. */
  runs: RunState[];
  /** The phases of `GET /runs/{name}`, one each; the last one stays. */
  phases: string[];
  /** The fields of an ended run besides its phase. */
  end: RunState;
  /** The answers of `GET /runs/{name}/log`, one each; after them `BOX_LOG`. */
  logs: Answer[];
  stop(): void;
}

function startFakeTenport(): FakeTenport {
  const fake: FakeTenport = {
    url: "",
    calls: [],
    posts: [],
    runs: [],
    phases: ["Running"],
    end: {},
    logs: [],
    stop: () => {},
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const url = new URL(request.url);
      const text = await request.text();
      const body = text === "" ? null : jsons.parse(text);
      const auth = request.headers.get("authorization");
      const call = { method: request.method, path: url.pathname, query: url.searchParams };
      fake.calls.push({ ...call, auth, body });
      return respond(answerOf(fake, request.method, url));
    },
  });
  fake.url = `http://127.0.0.1:${server.port}`;
  fake.stop = () => server.stop(true);
  return fake;
}

function answerOf(fake: FakeTenport, method: string, url: URL): Answer {
  const route = `${method} ${url.pathname}`;
  if (route === "POST /runs") return fake.posts.shift() ?? { status: HTTP_CREATED, body: newRun() };
  if (route === "GET /runs") return { status: HTTP_OK, body: runsOf(fake, url) };
  if (url.pathname.endsWith("/log")) return fake.logs.shift() ?? { status: HTTP_OK, body: BOX_LOG };
  if (method === "PUT") return { status: HTTP_OK, body: { name: lastPart(url) } };
  if (method === "DELETE") return { status: HTTP_NO_CONTENT };
  return { status: HTTP_OK, body: runOf(fake, lastPart(url)) };
}

const lastPart = (url: URL): string => url.pathname.split("/").pop() ?? "";

function respond(answer: Answer): Response {
  const { status, body, retryAfter } = answer;
  const headers: Record<string, string> =
    retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) };
  if (typeof body === "string") return new Response(body, { status, headers });
  if (body === undefined) return new Response(null, { status, headers });
  return Response.json(body, { status, headers });
}

const newRun = () => ({ name: RUN, project: PROJECT_ID, task: "TEN-1" });

const runsOf = (fake: FakeTenport, url: URL) =>
  fake.runs.filter((run) => run.task === url.searchParams.get("task"));

function runOf(fake: FakeTenport, name: string): RunState {
  const [phase = "Running", ...rest] = fake.phases;
  if (rest.length > 0) fake.phases = rest;
  const ended = phase === "Running" ? {} : fake.end;
  return { ...runState({ name, phase }), ...ended };
}

interface RunInput {
  name: string;
  phase: string;
  task?: string;
}

function runState(input: RunInput): RunState {
  const { name, phase, task = "TEN-1" } = input;
  return {
    name,
    project: PROJECT_ID,
    task,
    command: "build",
    class: "build",
    created: CREATED,
    phase,
    reason: null,
    exit_code: null,
    oom_kill: null,
    output: null,
  };
}

interface ProblemInput {
  status: number;
  code: string;
  detail: string;
}

const problem = (input: ProblemInput): Answer => ({
  status: input.status,
  body: { type: "about:blank", title: "", ...input },
});

const busyProblem = () =>
  problem({ status: HTTP_CONFLICT, code: "machine-busy", detail: "a Job of the task still runs" });

/** Tenport's `box-not-started` answer for a box that waits with this reason. */
const notStarted = (reason: string): Answer => ({
  ...problem({
    status: HTTP_CONFLICT,
    code: "box-not-started",
    detail: `the box container of the run ${RUN} has not started: ${reason}`,
  }),
  retryAfter: 1,
});

describe("machine", () => {
  let tenport: FakeTenport;

  const writeManifest = (lines: string) =>
    files.write(
      path.join(project.mainDir, "tenbox.yaml"),
      `project: demo\nid: ${PROJECT_ID}\n${lines}`,
    );

  const writeLocal = (text: string) =>
    files.write(path.join(project.mainDir, "tenbox.local.yaml"), text);

  const run = (words: string[]) => machine(["run", "TEN-1", "--", "tenbox", ...words, "TEN-1"]);

  const calls = (method: string, prefix: string) =>
    tenport.calls.filter((c) => c.method === method && c.path.startsWith(prefix));

  const postedRun = () => calls("POST", "/runs")[0]?.body;

  beforeEach(async () => {
    tenport = startFakeTenport();
    await writeManifest("");
    await git.run(["remote", "add", "origin", "https://github.com/o/demo.git"], project.mainDir);
    await writeLogin(Date.now() + DAY_MS);
    env.TENPORT_URL = tenport.url;
    env.TENPORT_TOKEN = TENPORT_TOKEN;
    fakeTool("gh", (args) =>
      args.join(" ") === "api user" ? { stdout: JSON.stringify(GITHUB_USER) } : { code: 1 },
    );
  });

  afterEach(() => tenport.stop());

  describe("machine run", () => {
    test("posts the run to Tenport and names it", async () => {
      const started = await run(["build"]);
      expect(started.json).toEqual({ ok: true, task: "TEN-1", cmd: "build", run: RUN });
      expect(postedRun()).toEqual({
        project: PROJECT_ID,
        task: "TEN-1",
        command: ["tenbox", "build", "TEN-1"],
        base: "main",
        class: "build",
        author: AUTHOR,
        services: [],
        env: {},
      });
      expect(calls("POST", "/runs")[0]?.auth).toBe(`Bearer ${TENPORT_TOKEN}`);
    });

    test("the setup, the base and machine.env of the manifest reach the run", async () => {
      await writeManifest("setup: bun install\nbase: develop\nmachine: { env: { A: one } }\n");
      await run(["build"]);
      expect(postedRun()).toMatchObject({
        setup: "bun install",
        base: "develop",
        env: { A: "one" },
      });
    });

    test("a GitHub user with no name is the author by login", async () => {
      fakeTool("gh", () => ({ stdout: JSON.stringify({ ...GITHUB_USER, name: null }) }));
      await run(["build"]);
      expect(postedRun()).toMatchObject({ author: { name: "octo", email: AUTHOR.email } });
    });

    test("stops before Tenport when gh cannot name the user", async () => {
      fakeTool("gh", () => ({ code: 1, stderr: "not logged in" }));
      const started = await run(["build"]);
      expect(started.json.ok).toBe(false);
      expect(tenport.calls).toEqual([]);
    });

    test("the tracker key and the ntfy URL become project secrets before the run", async () => {
      await writeManifest("tracker: { kind: clickup, list_id: '1' }\n");
      await writeLocal(`tracker: { api_key: ${TRACKER_KEY} }\nnotify: { ntfy: ${NTFY_URL} }\n`);
      await run(["build"]);
      expect(tenport.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        `PUT /projects/${PROJECT_ID}/secrets/tracker_api_key`,
        `PUT /projects/${PROJECT_ID}/secrets/ntfy_url`,
        "POST /runs",
      ]);
      expect(calls("PUT", "/projects").map((c) => c.body)).toEqual([
        { value: TRACKER_KEY },
        { value: NTFY_URL },
      ]);
    });

    test("without a key in the manifest the secret takes the tracker's env variable", async () => {
      await writeManifest("tracker: { kind: clickup, list_id: '1' }\n");
      env.CLICKUP_API_KEY = TRACKER_KEY;
      await run(["build"]);
      expect(calls("PUT", "/projects").map((c) => c.body)).toEqual([{ value: TRACKER_KEY }]);
    });

    test("a project with no tracker key and no ntfy writes no secret", async () => {
      await run(["build"]);
      expect(calls("PUT", "/projects")).toEqual([]);
    });

    test("a project without an id is no-project-id before any request", async () => {
      await files.write(path.join(project.mainDir, "tenbox.yaml"), "project: demo\n");
      const started = await run(["build"]);
      expect(started.json.code).toBe("no-project-id");
      expect(tenport.calls).toEqual([]);
    });

    test("without TENPORT_URL it is no-tenport before any request", async () => {
      env.TENPORT_URL = "";
      const started = await run(["build"]);
      expect(started.json.code).toBe("no-tenport");
      expect(tenport.calls).toEqual([]);
    });

    test("an expired refresh token is login-expired and sends no request", async () => {
      await writeLogin(Date.now() - MINUTE_MS);
      const started = await run(["build"]);
      expect(started.json.code).toBe("login-expired");
      expect(String(started.json.error)).toContain("/login");
      expect(tenport.calls).toEqual([]);
    });

    test("a missing .credentials.json is no-login and sends no request", async () => {
      await files.remove(path.join(claudeDir, ".credentials.json"));
      const started = await run(["build"]);
      expect(started.json.code).toBe("no-login");
      expect(tenport.calls).toEqual([]);
    });

    test("start runs in the class of machine.plan_class", async () => {
      await writeManifest("machine: { plan_class: build }\n");
      await run(["start"]);
      expect(postedRun()).toMatchObject({ class: "build" });
    });

    test("approve runs in the plan class without services", async () => {
      await writeManifest("machine: { services: [postgres] }\n");
      await run(["approve"]);
      expect(postedRun()).toMatchObject({ class: "plan", services: [] });
    });

    test("a build takes machine.class and machine.services", async () => {
      await writeManifest("machine: { class: heavy, services: [postgres] }\n");
      await run(["build"]);
      expect(postedRun()).toMatchObject({ class: "heavy", services: ["postgres"] });
    });

    test("pr takes no services and its flags reach the command", async () => {
      await writeManifest("machine: { services: [postgres] }\n");
      await machine(["run", "TEN-1", "--", "tenbox", "pr", "TEN-1", "--ready"]);
      expect(postedRun()).toMatchObject({
        command: ["tenbox", "pr", "TEN-1", "--ready"],
        class: "plan",
        services: [],
      });
    });

    test("a command, a task or a flag that is not allowed is a usage error", async () => {
      const refused = [
        ["run", "TEN-1", "--", "tenbox", "merge-check", "TEN-1"],
        ["run", "TEN-1", "--", "tenbox", "build", "TEN-2"],
        ["run", "TEN-1", "--", "tenbox", "build", "TEN-1", "--force"],
        ["run", "TEN-1", "--", "bash", "-c", "x"],
      ];
      for (const args of refused) {
        const started = await machine(args);
        expect(started.code).toBe(USAGE_EXIT);
      }
      expect(tenport.calls).toEqual([]);
    });

    test("machine.template is no field of the manifest any more", async () => {
      await writeManifest("machine: { template: ~/tenyard/task }\n");
      const started = await run(["build"]);
      expect(started.json.ok).toBe(false);
      expect(tenport.calls).toEqual([]);
    });

    test("a busy task is machine-busy and names the running run", async () => {
      tenport.posts = [busyProblem()];
      tenport.runs = [runState({ name: OLD_RUN, phase: "Running" })];
      const started = await run(["build"]);
      expect(started.json.code).toBe("machine-busy");
      expect(String(started.json.error)).toContain(OLD_RUN);
    });

    test("a user with no agent is no-agent and says how to add one", async () => {
      tenport.posts = [
        problem({ status: HTTP_BAD_REQUEST, code: "no-agent", detail: "the user has no agent" }),
      ];
      const started = await run(["build"]);
      expect(started.json.code).toBe("no-agent");
      expect(String(started.json.error)).toContain("tenbox agent add <name>");
      expect(String(started.json.error)).toContain("tenbox agent login");
    });

    test("a Tenport without an answer for a moment is asked again", async () => {
      tenport.posts = [
        problem({ status: HTTP_SERVICE_UNAVAILABLE, code: "unavailable", detail: "starting" }),
      ];
      const started = await run(["build"]);
      expect(started.json).toMatchObject({ ok: true, run: RUN });
      expect(calls("POST", "/runs")).toHaveLength(2);
    });
  });

  describe("machine run --wait", () => {
    const waitRun = (words: string[], flags: string[] = []) =>
      machine(["run", "TEN-1", "--wait", ...flags, "--", "tenbox", ...words, "TEN-1"]);

    test("prints Tenport's result after the run Succeeded", async () => {
      tenport.phases = ["Running", "Succeeded"];
      tenport.end = { reason: "Completed", exit_code: 0, oom_kill: 0, output: OUTPUT };
      const waited = await waitRun(["approve"]);
      expect(waited.json).toEqual({
        ok: true,
        task: "TEN-1",
        cmd: "approve",
        run: RUN,
        phase: "Succeeded",
        reason: "Completed",
        exit_code: 0,
        oom_kill: 0,
        output: OUTPUT,
      });
      expect(tenport.calls.filter((c) => c.path.endsWith("/log"))).toEqual([]);
    });

    test("a Failed run is machine-failed with Tenport's result", async () => {
      tenport.phases = ["Failed"];
      tenport.end = { reason: "OOMKilled", exit_code: 137, oom_kill: 1 };
      const waited = await waitRun(["build"]);
      expect([waited.code, waited.json.code]).toEqual([1, "machine-failed"]);
      expect(waited.json.details).toMatchObject({
        run: RUN,
        phase: "Failed",
        reason: "OOMKilled",
        exit_code: 137,
        oom_kill: 1,
        output: null,
      });
    });

    test("a run that ended with the archive exit code is archive-failed", async () => {
      tenport.phases = ["Failed"];
      tenport.end = { reason: "Error", exit_code: 75, oom_kill: 0 };
      const waited = await waitRun(["decide"]);
      expect([waited.code, waited.json.code]).toEqual([1, "archive-failed"]);
      expect(waited.json.details).toMatchObject({ run: RUN, phase: "Failed", exit_code: 75 });
    });

    test("an Unknown run is machine-failed", async () => {
      tenport.phases = ["Unknown"];
      const waited = await waitRun(["build"]);
      expect(waited.json.code).toBe("machine-failed");
      expect(waited.json.details).toMatchObject({ phase: "Unknown" });
    });

    test("a busy task is asked again until the run starts", async () => {
      tenport.posts = [busyProblem()];
      tenport.phases = ["Succeeded"];
      const waited = await waitRun(["status"]);
      expect(waited.json).toMatchObject({ ok: true, run: RUN, phase: "Succeeded" });
      expect(calls("POST", "/runs")).toHaveLength(2);
    });

    test("past the timeout it is machine-timeout and the run goes on", async () => {
      const waited = await waitRun(["build"], ["--timeout", "0"]);
      expect(waited.json.code).toBe("machine-timeout");
      expect(String(waited.json.error)).toContain(RUN);
      expect(calls("DELETE", "/runs")).toEqual([]);
    });
  });

  describe("machine ls", () => {
    test("lists the runs of each task it names", async () => {
      tenport.runs = [
        runState({ name: OLD_RUN, phase: "Succeeded" }),
        runState({ name: "task-ten-2-1118-100000", phase: "Running", task: "TEN-2" }),
        runState({ name: "task-ten-3-1118-100000", phase: "Running", task: "TEN-3" }),
      ];
      const listed = await machine(["ls", "TEN-1", "TEN-2"]);
      expect(listed.json).toEqual({ ok: true, runs: tenport.runs.slice(0, 2) });
      const asked = calls("GET", "/runs").map((c) => [c.query.get("project"), c.query.get("task")]);
      expect(asked).toEqual([
        [PROJECT_ID, "TEN-1"],
        [PROJECT_ID, "TEN-2"],
      ]);
    });

    test("without a task id it is a usage error", async () => {
      const listed = await machine(["ls"]);
      expect(listed.code).toBe(USAGE_EXIT);
      expect(tenport.calls).toEqual([]);
    });
  });

  describe("machine logs", () => {
    const logCalls = () => calls("GET", `/runs/${RUN}/log`);

    beforeEach(() => {
      tenport.runs = [
        runState({ name: OLD_RUN, phase: "Succeeded" }),
        runState({ name: RUN, phase: "Running" }),
      ];
      tenport.phases = ["Succeeded"];
    });

    test("prints the newest run's log to stderr and its phase on stdout", async () => {
      const shown = await machine(["logs", "TEN-1"]);
      expect(shown.err).toContain(BOX_LOG);
      expect(shown.json).toEqual({
        ok: true,
        task: "TEN-1",
        run: RUN,
        phase: "Succeeded",
        reason: null,
      });
      expect(logCalls()[0]?.query.get("follow")).toBe("false");
    });

    test("--follow asks again after Retry-After while the box has not started", async () => {
      tenport.logs = [notStarted("ContainerCreating")];
      const shown = await machine(["logs", "TEN-1", "--follow"]);
      expect(shown.json).toMatchObject({ ok: true, run: RUN });
      expect(logCalls().map((c) => c.query.get("follow"))).toEqual(["true", "true"]);
    });

    test("--follow stops at a box that cannot start by itself and names the reason", async () => {
      tenport.logs = [notStarted("ErrImagePull")];
      const shown = await machine(["logs", "TEN-1", "--follow"]);
      expect(shown.json.code).toBe("box-not-started");
      expect(String(shown.json.error)).toContain("ErrImagePull");
      expect(logCalls()).toHaveLength(1);
    });

    test("the log of a run whose Job is gone is job-gone", async () => {
      tenport.logs = [
        problem({ status: HTTP_CONFLICT, code: "job-gone", detail: "the Job of the run is gone" }),
      ];
      const shown = await machine(["logs", "TEN-1"]);
      expect(shown.json.code).toBe("job-gone");
    });

    test("a task with no run is no-machine-run", async () => {
      tenport.runs = [];
      const shown = await machine(["logs", "TEN-1"]);
      expect(shown.json.code).toBe("no-machine-run");
    });

    test("a failed log request does not show the token", async () => {
      tenport.logs = [
        problem({ status: HTTP_NOT_FOUND, code: "not-found", detail: "Tenport does not know it" }),
      ];
      const shown = await machine(["logs", "TEN-1"]);
      expect(shown.json.ok).toBe(false);
      expect(shown.out + shown.err).not.toContain(TENPORT_TOKEN);
    });
  });

  describe("machine stop", () => {
    test("stops only the running runs of the task", async () => {
      tenport.runs = [
        runState({ name: OLD_RUN, phase: "Succeeded" }),
        runState({ name: RUN, phase: "Running" }),
      ];
      const stopped = await machine(["stop", "TEN-1"]);
      expect(stopped.json).toEqual({ ok: true, task: "TEN-1", stopped: [RUN] });
      expect(calls("DELETE", "/runs").map((c) => c.path)).toEqual([`/runs/${RUN}`]);
    });

    test("a task with no running run is ok with an empty list", async () => {
      const stopped = await machine(["stop", "TEN-1"]);
      expect(stopped.json).toEqual({ ok: true, task: "TEN-1", stopped: [] });
    });

    test("without an id or with an extra word it is a usage error", async () => {
      const bare = await machine(["stop"]);
      expect(bare.code).toBe(USAGE_EXIT);
      const extra = await machine(["stop", "TEN-1", "TEN-2"]);
      expect(extra.code).toBe(USAGE_EXIT);
    });
  });

  test("machine rm is no command: a person deletes an archive, not an agent", async () => {
    const removed = await machine(["rm", "TEN-1"]);
    expect(removed.code).toBe(USAGE_EXIT);
    expect(tenport.calls).toEqual([]);
  });

  test("--follow with another action is a usage error and sends no request", async () => {
    const listed = await machine(["ls", "TEN-1", "--follow"]);
    expect(listed.code).toBe(USAGE_EXIT);
    expect(tenport.calls).toEqual([]);
  });

  test("tenbox help machine names no project GitHub token", async () => {
    const help = await tenbox(["help", "machine"], project.mainDir, env);
    expect(help.out + help.err).not.toContain("github_token");
  });
});
