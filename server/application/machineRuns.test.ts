import { afterEach, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "bun";
import { z } from "zod";
import type { ListedPod } from "../../domain/events.ts";
import { type Db, database } from "../infra/db/index.ts";
import type { KubernetesApi } from "../infra/kubernetes.ts";
import { createApp } from "../routes/index.ts";
import { machineRuns } from "./machineRuns.ts";
import { users } from "./users.ts";

const TOKEN = "sa-token";
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const PODS_PATH = "/api/v1/namespaces/tenbox/pods";
const JOB = "task-ten-7-1105-100000";
const CREATED = "2026-11-05T10:00:00Z";
const SCHEDULED = "2026-11-05T10:00:02Z";
const STARTED = "2026-11-05T10:00:20Z";
const FINISHED = "2026-11-05T10:05:20Z";
const POLL_AT = new Date("2026-11-05T11:00:00Z");
const RunsSchema = z.object({ ok: z.boolean(), runs: z.array(z.looseObject({ pod: z.string() })) });
const DocSchema = z.object({ paths: z.record(z.string(), z.unknown()) });

/** One pod of a task Job: running while `exitCode` is undefined. */
interface FakePod {
  uid: string;
  name: string;
  task?: string;
  exitCode?: number;
  reason?: string;
  finished?: string;
  log?: string;
  command?: string;
}

/** The fake cluster: the pods it lists and the log requests it got. */
interface Fakes {
  db: Db;
  pods: FakePod[];
  logCalls: string[];
  logFails: boolean;
  kubernetes: KubernetesApi;
}

const roots: string[] = [];
const servers: Server<undefined>[] = [];
const dbs: Db[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) database.close(db);
  for (const server of servers.splice(0)) server.stop(true);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function boxState(pod: FakePod) {
  if (pod.exitCode === undefined) return { running: { startedAt: STARTED } };
  const terminated = {
    exitCode: pod.exitCode,
    reason: pod.reason ?? "Error",
    startedAt: STARTED,
    finishedAt: pod.finished ?? FINISHED,
  };
  return { terminated };
}

function apiPod(pod: FakePod) {
  const task = pod.task ?? "TEN-7";
  return {
    metadata: {
      name: pod.name,
      uid: pod.uid,
      creationTimestamp: CREATED,
      labels: { app: "tenyard", task, class: "build", "job-name": JOB },
    },
    spec: {
      nodeName: "worker-1",
      containers: [
        {
          name: "box",
          env: [
            { name: "TENBOX_TASK", value: task },
            { name: "TENBOX_PROJECT", value: "demo" },
            { name: "TENBOX_CMD", value: pod.command ?? `tenbox build ${task}` },
            { name: "TRACKER_API_KEY", valueFrom: { secretKeyRef: { name: "p", key: "k" } } },
          ],
          resources: { requests: { cpu: "500m", memory: "2Gi" }, limits: { memory: "2Gi" } },
        },
      ],
    },
    status: {
      phase: pod.exitCode === undefined ? "Running" : "Failed",
      conditions: [
        { type: "Initialized", status: "True", lastTransitionTime: CREATED },
        { type: "PodScheduled", status: "True", lastTransitionTime: SCHEDULED },
      ],
      containerStatuses: [{ name: "box", state: boxState(pod) }],
    },
  };
}

function answer(fakes: Fakes, request: Request): Response {
  if (request.headers.get("Authorization") !== `Bearer ${TOKEN}`) {
    return new Response("", { status: HTTP_UNAUTHORIZED });
  }
  const url = new URL(request.url);
  if (url.pathname === PODS_PATH && url.searchParams.get("labelSelector") === "app=tenyard") {
    return Response.json({ kind: "PodList", items: fakes.pods.map(apiPod) });
  }
  const log = /^\/api\/v1\/namespaces\/tenbox\/pods\/([^/]+)\/log$/.exec(url.pathname)?.[1];
  const pod = fakes.pods.find((item) => item.name === log);
  const tail = url.search === "?container=box&tailLines=1";
  const whole = url.search === "?container=box";
  if (pod === undefined || !(tail || whole)) return new Response("", { status: HTTP_NOT_FOUND });
  fakes.logCalls.push(tail ? pod.name : `${pod.name} (whole)`);
  if (fakes.logFails) return new Response("", { status: HTTP_FORBIDDEN });
  return new Response(pod.log ?? "tenbox-boot: memory peak 300 MiB, cpu 5 s, oom_kill 0\n");
}

function setup(): Fakes {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-runs-"));
  roots.push(root);
  const tokenFile = path.join(root, "token");
  const caFile = path.join(root, "ca.crt");
  fs.writeFileSync(tokenFile, `${TOKEN}\n`);
  fs.writeFileSync(caFile, "a CA");
  const db = database.open(path.join(root, "server.db"));
  dbs.push(db);
  const fakes: Fakes = {
    db,
    pods: [],
    logCalls: [],
    logFails: false,
    kubernetes: { url: "", tokenFile, caFile },
  };
  const cluster = Bun.serve({ port: 0, fetch: (request) => answer(fakes, request) });
  servers.push(cluster);
  fakes.kubernetes.url = `http://127.0.0.1:${cluster.port}`;
  return fakes;
}

interface Row {
  id: string;
  type: string;
  subject: string;
  user_id: string | null;
  tenbox: string;
  at: string;
  body: string;
}

function rows(db: Db): Row[] {
  return db.$client.query<Row, []>("select * from events order by rowid").all();
}

function bodies(db: Db): Record<string, unknown>[] {
  return rows(db).map((row) => JSON.parse(row.body));
}

function pollOnce(fakes: Fakes, seen: ListedPod[] = []): Promise<ListedPod[]> {
  return machineRuns.poll(fakes.db, { kubernetes: fakes.kubernetes, seen, at: POLL_AT });
}

const ENDED: FakePod = { uid: "uid-1", name: `${JOB}-abcde`, exitCode: 1 };

test("stores job.finished for an ended box pod", async () => {
  const fakes = setup();
  fakes.pods = [ENDED, { uid: "uid-2", name: `${JOB}-fghij` }];
  await pollOnce(fakes);
  const [row, ...rest] = rows(fakes.db);
  expect(rest).toEqual([]);
  expect(row).toMatchObject({
    id: "job.finished:uid-1",
    type: "job.finished",
    subject: "TEN-7",
    user_id: null,
    tenbox: "server",
    at: "2026-11-05T10:05:20.000Z",
  });
  expect(JSON.parse(row?.body ?? "")).toEqual({
    event: "job.finished",
    task: "TEN-7",
    project: "demo",
    job: JOB,
    pod: `${JOB}-abcde`,
    command: "tenbox build TEN-7",
    class: "build",
    node: "worker-1",
    exit_code: 1,
    oom: false,
    created: "2026-11-05T10:00:00.000Z",
    scheduled: "2026-11-05T10:00:02.000Z",
    started: "2026-11-05T10:00:20.000Z",
    finished: "2026-11-05T10:05:20.000Z",
    duration_ms: 300_000,
    requests: { cpu: "500m", memory: "2Gi" },
  });
});

test("second poll stores nothing twice", async () => {
  const fakes = setup();
  fakes.pods = [ENDED];
  const seen = await pollOnce(fakes);
  await pollOnce(fakes, seen);
  expect(rows(fakes.db).map((row) => row.id)).toEqual(["job.finished:uid-1"]);
  expect(fakes.logCalls).toEqual([`${JOB}-abcde`]);
});

test("oom from reason or boot log line", async () => {
  const fakes = setup();
  fakes.pods = [
    { uid: "uid-1", name: "by-reason", exitCode: 137, reason: "OOMKilled" },
    {
      uid: "uid-2",
      name: "by-log",
      exitCode: 1,
      log: "tenbox-boot: memory peak 3000 MiB, cpu 50 s, oom_kill 1\n",
    },
    {
      uid: "uid-3",
      name: "no-oom",
      exitCode: 0,
      reason: "Completed",
      log: "tenbox-boot: memory peak 300 MiB, cpu 5 s, oom_kill 0\n",
    },
  ];
  await pollOnce(fakes);
  const oom = Object.fromEntries(bodies(fakes.db).map((body) => [body.pod, body.oom]));
  expect(oom).toEqual({ "by-reason": true, "by-log": true, "no-oom": false });
});

test("pod gone before it ended is stored with null exit code", async () => {
  const fakes = setup();
  fakes.pods = [{ uid: "uid-2", name: `${JOB}-fghij` }];
  const seen = await pollOnce(fakes);
  expect(rows(fakes.db)).toEqual([]);
  fakes.pods = [];
  await pollOnce(fakes, seen);
  const [row, ...rest] = rows(fakes.db);
  expect(rest).toEqual([]);
  expect(row).toMatchObject({ id: "job.finished:uid-2", at: "2026-11-05T11:00:00.000Z" });
  expect(JSON.parse(row?.body ?? "")).toMatchObject({
    exit_code: null,
    oom: false,
    started: "2026-11-05T10:00:20.000Z",
    finished: "2026-11-05T11:00:00.000Z",
    duration_ms: 3_580_000,
  });
  expect(fakes.logCalls).toEqual([]);
});

test("an ended pod whose log fails is logged and stored on the next poll", async () => {
  const fakes = setup();
  fakes.pods = [ENDED];
  fakes.logFails = true;
  const errors = spyOn(console, "error").mockImplementation(() => undefined);
  const seen = await pollOnce(fakes);
  const calls = [...errors.mock.calls];
  errors.mockRestore();
  expect(rows(fakes.db)).toEqual([]);
  expect(calls).toEqual([[expect.stringContaining(`job watch: pod ${JOB}-abcde`)]]);
  fakes.logFails = false;
  await pollOnce(fakes, seen);
  expect(rows(fakes.db).map((row) => row.id)).toEqual(["job.finished:uid-1"]);
});

test("POST /events refuses job.finished", async () => {
  const fakes = setup();
  const saved = users.save(fakes.db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "member",
  });
  const event = {
    id: "job.finished:uid-1",
    schema: 1,
    event: "job.finished",
    user: "u-4k2m7a",
    tenbox: "server",
    at: "2026-11-05T10:05:20Z",
    sent_at: "2026-11-05T10:05:25Z",
    task: "TEN-7",
    pod: `${JOB}-abcde`,
    exit_code: 1,
  };
  const response = await createApp(fakes.db).request("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${saved.token}` },
    body: JSON.stringify([event]),
  });
  expect(response.status).toBe(400);
  const problem = await response.json();
  expect(problem).toMatchObject({ code: "bad-input" });
  expect(rows(fakes.db)).toEqual([]);
});

test("GET task runs lists the stored runs", async () => {
  const fakes = setup();
  fakes.pods = [
    {
      uid: "uid-late",
      name: "late",
      exitCode: 0,
      reason: "Completed",
      finished: "2026-11-05T10:30:00Z",
    },
    ENDED,
    { uid: "uid-other", name: "other", task: "TEN-8", exitCode: 0 },
  ];
  await pollOnce(fakes);
  const saved = users.save(fakes.db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "member",
  });
  const app = createApp(fakes.db);
  const headers = { Authorization: `Bearer ${saved.token}` };
  const response = await app.request("/tasks/TEN-7/runs", { headers });
  expect(response.status).toBe(200);
  const runs = await response.json();
  const body = RunsSchema.parse(runs);
  expect(body.ok).toBe(true);
  expect(body.runs.map((run) => run.pod)).toEqual([`${JOB}-abcde`, "late"]);
  expect(body.runs[0]).toMatchObject({
    task: "TEN-7",
    exit_code: 1,
    command: "tenbox build TEN-7",
  });
  const none = await app.request("/tasks/TEN-9/runs", { headers });
  const noRuns = await none.json();
  expect(noRuns).toEqual({ ok: true, runs: [] });
  const anonymous = await app.request("/tasks/TEN-7/runs");
  expect(anonymous.status).toBe(HTTP_UNAUTHORIZED);
  const docResponse = await app.request("/openapi.json");
  const docJson = await docResponse.json();
  const doc = DocSchema.parse(docJson);
  expect(Object.keys(doc.paths)).toContain("/tasks/{task}/runs");
});

const CLOSE_JSON = `{
  "ok": true,
  "task": "TEN-7",
  "stats": {
    "path": "/x/stats.json",
    "state": "written"
  }
}
`;
const BOOT_LINE = "tenbox-boot: memory peak 300 MiB, cpu 5 s, oom_kill 0\n";
const CLOSED: FakePod = {
  uid: "uid-c",
  name: `${JOB}-close`,
  exitCode: 0,
  command: "tenbox close TEN-7",
  log: `warning: x\n${CLOSE_JSON}${BOOT_LINE}`,
};

test("a close pod with exit 0 stores its close output", async () => {
  const fakes = setup();
  fakes.pods = [CLOSED];
  await pollOnce(fakes);
  const stored = rows(fakes.db);
  expect(stored.map((row) => row.id).sort()).toEqual(["close.output:uid-c", "job.finished:uid-c"]);
  const row = stored.find((item) => item.id === "close.output:uid-c");
  expect(row).toMatchObject({ type: "close.output", subject: "TEN-7", user_id: null });
  expect(JSON.parse(row?.body ?? "")).toEqual({
    ok: true,
    task: "TEN-7",
    stats: { path: "/x/stats.json", state: "written" },
  });
  expect(fakes.logCalls).toEqual([`${JOB}-close (whole)`]);
});

test("a failed close stores no close output", async () => {
  const fakes = setup();
  fakes.pods = [{ ...CLOSED, exitCode: 1 }];
  await pollOnce(fakes);
  expect(rows(fakes.db).map((row) => row.id)).toEqual(["job.finished:uid-c"]);
  expect(fakes.logCalls).toEqual([`${JOB}-close`]);
});

test("a pod of another command stores no close output", async () => {
  const fakes = setup();
  fakes.pods = [{ ...CLOSED, command: "tenbox build TEN-7" }];
  await pollOnce(fakes);
  expect(rows(fakes.db).map((row) => row.id)).toEqual(["job.finished:uid-c"]);
});

test("a second poll stores the close output once", async () => {
  const fakes = setup();
  fakes.pods = [CLOSED];
  const seen = await pollOnce(fakes);
  await pollOnce(fakes, seen);
  expect(rows(fakes.db)).toHaveLength(2);
  expect(fakes.logCalls).toEqual([`${JOB}-close (whole)`]);
});

test("a close log with no JSON object is one stderr line and no close output", async () => {
  const fakes = setup();
  fakes.pods = [{ ...CLOSED, log: `no json here\n${BOOT_LINE}` }];
  const errors = spyOn(console, "error").mockImplementation(() => undefined);
  await pollOnce(fakes);
  const calls = [...errors.mock.calls];
  errors.mockRestore();
  expect(rows(fakes.db).map((row) => row.id)).toEqual(["job.finished:uid-c"]);
  expect(calls).toHaveLength(1);
  expect(String(calls[0]?.[0])).toContain("job watch: pod");
});
