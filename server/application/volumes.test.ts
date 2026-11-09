import { afterEach, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "bun";
import { type Db, database } from "../infra/db/index.ts";
import type { VolumeEnv } from "../infra/env.ts";
import type { HetznerApi } from "../infra/hetzner.ts";
import type { KubernetesApi } from "../infra/kubernetes.ts";
import { createApp } from "../routes/index.ts";
import { events } from "./events.ts";
import { users } from "./users.ts";
import { volumes } from "./volumes.ts";

const TOKEN = "sa-token";
const HCLOUD_TOKEN = "hcloud-token";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;
const PVCS_PATH = "/api/v1/namespaces/tenbox/persistentvolumeclaims";
const PODS_PATH = "/api/v1/namespaces/tenbox/pods";
const NTFY_TOPIC = "tenbox-idle";
const GRACE_DAYS = 3;
const UID = "pvc-uid-1";
const LEFT_AT = new Date("2026-11-05T12:00:30Z");
const STARTED_AT = new Date("2026-11-06T08:00:00Z");
const PRICE = { net: "0.0440", gross: "0.0524" };

/** One PVC as the Kubernetes API lists it. */
interface FakePvc {
  name: string;
  uid: string;
  task: string;
  phase: string;
  /** `status.capacity.storage`; a PVC that is not bound has none. */
  storage?: string;
  created?: string;
}

/** The fake cluster, Hetzner and ntfy: what they list, how often Hetzner was asked, and the DELETEs and notices they got. */
interface Fakes {
  db: Db;
  listed: FakePvc[];
  hetznerCalls: number;
  kubernetes: KubernetesApi;
  hetzner: HetznerApi;
  /** The task labels of the listed Job pods. */
  podTasks: string[];
  /** The paths of the DELETE requests. */
  deletes: string[];
  /** The answers to the next DELETEs; 200, which removes the PVC from the list, when none is left. */
  deleteStatuses: number[];
  /** The JSON bodies posted to ntfy. */
  notices: unknown[];
  /** The answers to the next ntfy POSTs; 200 when none is left. */
  ntfyStatuses: number[];
  env: VolumeEnv;
  now: Date;
  poll: () => Promise<void>;
}

/** One stored run of a task. */
interface SavedRun {
  task: string;
  created: string;
  finished: string;
}

const roots: string[] = [];
const servers: Server<undefined>[] = [];
const dbs: Db[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) database.close(db);
  for (const server of servers.splice(0)) server.stop(true);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

const BOUND_PVC: FakePvc = {
  name: "task-187",
  uid: UID,
  task: "187",
  phase: "Bound",
  storage: "10Gi",
};

const TEN7_PVC: FakePvc = {
  ...BOUND_PVC,
  name: "task-ten-7",
  uid: "pvc-uid-7",
  task: "TEN-7",
  created: "2026-11-01T10:00:00Z",
};
const TEN7_DELETE = `${PVCS_PATH}/task-ten-7`;
const IDLE_LINE = (days: number) =>
  `tenbox-demo · TEN-7 · idle-volume · ${days} days → tenbox machine rm TEN-7`;

function bearer(request: Request, token: string): boolean {
  return request.headers.get("Authorization") === `Bearer ${token}`;
}

function pvcItem(pvc: FakePvc): unknown {
  return {
    metadata: {
      name: pvc.name,
      uid: pvc.uid,
      creationTimestamp: pvc.created ?? "2026-11-05T10:00:00Z",
      labels: { app: "tenyard", task: pvc.task },
    },
    spec: { resources: { requests: { storage: "10Gi" } } },
    status:
      pvc.storage === undefined
        ? { phase: pvc.phase }
        : { phase: pvc.phase, capacity: { storage: pvc.storage } },
  };
}

function podItem(task: string, index: number): unknown {
  return {
    metadata: {
      name: `pod-${index}`,
      uid: `pod-uid-${index}`,
      creationTimestamp: "2026-11-05T10:00:00Z",
      labels: { app: "tenyard", task },
    },
    spec: { containers: [] },
  };
}

function answerPvc(fakes: Fakes, request: Request): Response {
  const url = new URL(request.url);
  fakes.deletes.push(url.pathname);
  const status = fakes.deleteStatuses.shift() ?? HTTP_OK;
  if (status !== HTTP_OK) return new Response("no", { status });
  const name = url.pathname.slice(PVCS_PATH.length + 1);
  fakes.listed = fakes.listed.filter((pvc) => pvc.name !== name);
  return Response.json({ kind: "PersistentVolumeClaim" });
}

function answerCluster(fakes: Fakes, request: Request): Response {
  if (!bearer(request, TOKEN)) return new Response("", { status: HTTP_UNAUTHORIZED });
  const url = new URL(request.url);
  if (request.method === "DELETE" && url.pathname.startsWith(`${PVCS_PATH}/`)) {
    return answerPvc(fakes, request);
  }
  if (url.searchParams.get("labelSelector") !== "app=tenyard") {
    return new Response("", { status: HTTP_NOT_FOUND });
  }
  if (url.pathname === PODS_PATH) {
    return Response.json({ kind: "PodList", items: fakes.podTasks.map(podItem) });
  }
  if (url.pathname !== PVCS_PATH) return new Response("", { status: HTTP_NOT_FOUND });
  return Response.json({ kind: "PersistentVolumeClaimList", items: fakes.listed.map(pvcItem) });
}

async function answerNtfy(fakes: Fakes, request: Request): Promise<Response> {
  const body: unknown = await request.json();
  fakes.notices.push(body);
  const status = fakes.ntfyStatuses.shift() ?? HTTP_OK;
  if (status !== HTTP_OK) return new Response("no", { status });
  return Response.json({ id: "msg-1" });
}

function setup(): Fakes {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-volumes-"));
  roots.push(root);
  const tokenFile = path.join(root, "token");
  const caFile = path.join(root, "ca.crt");
  fs.writeFileSync(tokenFile, `${TOKEN}\n`);
  fs.writeFileSync(caFile, "a CA");
  const db = database.open(path.join(root, "server.db"));
  dbs.push(db);
  const fakes: Fakes = {
    db,
    listed: [BOUND_PVC],
    hetznerCalls: 0,
    kubernetes: { url: "", tokenFile, caFile },
    hetzner: { url: "", token: HCLOUD_TOKEN },
    podTasks: [],
    deletes: [],
    deleteStatuses: [],
    notices: [],
    ntfyStatuses: [],
    env: { graceDays: GRACE_DAYS, ntfy: null },
    now: LEFT_AT,
    poll: () => Promise.resolve(),
  };
  fakes.poll = volumes.poller(db, {
    kubernetes: fakes.kubernetes,
    hetzner: fakes.hetzner,
    now: () => fakes.now,
    env: fakes.env,
  });
  const cluster = Bun.serve({ port: 0, fetch: (request) => answerCluster(fakes, request) });
  const ntfy = Bun.serve({ port: 0, fetch: (request) => answerNtfy(fakes, request) });
  const hetzner = Bun.serve({
    port: 0,
    fetch: (request) => {
      fakes.hetznerCalls += 1;
      if (!bearer(request, HCLOUD_TOKEN)) return new Response("", { status: HTTP_UNAUTHORIZED });
      if (new URL(request.url).pathname !== "/v1/pricing") {
        return new Response("", { status: HTTP_NOT_FOUND });
      }
      return Response.json({
        pricing: { currency: "EUR", vat_rate: "19.00", volume: { price_per_gb_month: PRICE } },
      });
    },
  });
  servers.push(cluster, hetzner, ntfy);
  fakes.kubernetes.url = `http://127.0.0.1:${cluster.port}`;
  fakes.env.ntfy = `http://127.0.0.1:${ntfy.port}/${NTFY_TOPIC}`;
  fakes.hetzner.url = `http://127.0.0.1:${hetzner.port}/v1`;
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

function pollAt(fakes: Fakes, at: Date): Promise<void> {
  fakes.now = at;
  return fakes.poll();
}

/** A poll at a day of November 2026, 10:00 UTC. */
function pollOn(fakes: Fakes, day: number): Promise<void> {
  return pollAt(fakes, novemberDay(day));
}

function novemberDay(day: number): Date {
  return new Date(Date.UTC(2026, 10, day, 10));
}

/** The volume of task TEN-7, made on November 1. */
function ten7(fakes: Fakes): void {
  fakes.listed = [TEN7_PVC];
}

function saveRun(fakes: Fakes, run: SavedRun): void {
  const uid = `pod-${run.created}`;
  events.saveFromServer(fakes.db, {
    id: `job.finished:${uid}`,
    type: "job.finished",
    subject: run.task,
    at: run.finished,
    body: {
      event: "job.finished",
      task: run.task,
      project: "tenbox-demo",
      job: null,
      pod: uid,
      command: `tenbox build ${run.task}`,
      class: "build",
      node: null,
      exit_code: 0,
      oom: false,
      created: run.created,
      scheduled: null,
      started: null,
      finished: run.finished,
      duration_ms: null,
      requests: { cpu: null, memory: null },
    },
  });
}

/** A close of TEN-7 on November 2: its run, and its `close.output`. */
function saveClose(fakes: Fakes): void {
  saveRun(fakes, {
    task: "TEN-7",
    created: "2026-11-02T09:55:00.000Z",
    finished: "2026-11-02T10:00:00.000Z",
  });
  events.saveFromServer(fakes.db, {
    id: "close.output:pod-close",
    type: "close.output",
    subject: "TEN-7",
    at: "2026-11-02T10:00:00.000Z",
    body: { ok: true, task: "TEN-7" },
  });
}

/** The stderr lines of one call, with console.error silenced while it runs. */
async function errorLines(run: () => Promise<void>): Promise<string[]> {
  const spy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await run();
    return spy.mock.calls.map((call) => String(call[0]));
  } finally {
    spy.mockRestore();
  }
}

function idleRows(fakes: Fakes): Row[] {
  return rows(fakes.db).filter((row) => row.type === "volume.idle");
}

test("a bound task PVC stores one volume.added priced from Hetzner", async () => {
  const fakes = setup();
  await pollAt(fakes, LEFT_AT);
  await pollAt(fakes, LEFT_AT);
  const [row, ...rest] = rows(fakes.db);
  expect(rest).toEqual([]);
  expect(row).toMatchObject({
    id: `volume.added:${UID}`,
    type: "volume.added",
    subject: "task-187",
    user_id: null,
    tenbox: "server",
    at: "2026-11-05T10:00:00.000Z",
  });
  expect(JSON.parse(row?.body ?? "")).toEqual({
    event: "volume.added",
    volume: "task-187",
    uid: UID,
    task: "187",
    size_gb: 10,
    price_per_gb_month: PRICE,
  });
  expect(fakes.hetznerCalls).toBe(1);
});

test("a PVC that is not Bound yet stores nothing", async () => {
  const fakes = setup();
  fakes.listed = [{ name: "task-187", uid: UID, task: "187", phase: "Pending" }];
  await pollAt(fakes, LEFT_AT);
  expect(rows(fakes.db)).toEqual([]);
  expect(fakes.hetznerCalls).toBe(0);
});

test("a PVC gone from the list stores volume.removed", async () => {
  const fakes = setup();
  await pollAt(fakes, LEFT_AT);
  fakes.listed = [];
  await pollAt(fakes, LEFT_AT);
  await pollAt(fakes, LEFT_AT);
  const [, row, ...rest] = rows(fakes.db);
  expect(rest).toEqual([]);
  expect(row).toMatchObject({
    id: `volume.removed:${UID}`,
    type: "volume.removed",
    subject: "task-187",
    user_id: null,
    tenbox: "server",
    at: "2026-11-05T12:00:30.000Z",
  });
  expect(JSON.parse(row?.body ?? "")).toEqual({
    event: "volume.removed",
    volume: "task-187",
    uid: UID,
    task: "187",
    size_gb: 10,
    late: false,
  });
});

test("a PVC gone while the server was down is late at its start", async () => {
  const fakes = setup();
  await pollAt(fakes, LEFT_AT);
  fakes.listed = [];
  const poll = volumes.poller(fakes.db, {
    kubernetes: fakes.kubernetes,
    hetzner: fakes.hetzner,
    now: () => STARTED_AT,
    env: fakes.env,
  });
  await poll();
  const removed = rows(fakes.db).filter((row) => row.type === "volume.removed");
  expect(removed).toHaveLength(1);
  expect(removed[0]?.at).toBe("2026-11-06T08:00:00.000Z");
  expect(JSON.parse(removed[0]?.body ?? "")).toMatchObject({ volume: "task-187", late: true });
});

test("volume events cannot be posted", async () => {
  const fakes = setup();
  const saved = users.save(fakes.db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "member",
  });
  const common = {
    schema: 1,
    user: "u-4k2m7a",
    tenbox: "server",
    at: "2026-11-05T10:00:00Z",
    sent_at: "2026-11-05T10:00:05Z",
    volume: "task-187",
    uid: UID,
    task: "187",
    size_gb: 10,
  };
  const posted = [
    { ...common, id: `volume.added:${UID}`, event: "volume.added", price_per_gb_month: PRICE },
    { ...common, id: `volume.removed:${UID}`, event: "volume.removed", late: false },
  ];
  for (const event of posted) {
    const response = await createApp(fakes.db).request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${saved.token}` },
      body: JSON.stringify([event]),
    });
    expect(response.status).toBe(HTTP_BAD_REQUEST);
  }
  expect(rows(fakes.db)).toEqual([]);
});

test("a closed task volume is deleted after the grace period", async () => {
  const fakes = setup();
  ten7(fakes);
  saveClose(fakes);
  await pollOn(fakes, 4);
  expect(fakes.deletes).toEqual([]);
  await pollOn(fakes, 6);
  expect(fakes.deletes).toEqual([TEN7_DELETE]);
  await pollOn(fakes, 6);
  expect(fakes.deletes).toEqual([TEN7_DELETE]);
  expect(rows(fakes.db).map((row) => row.type)).toContain("volume.removed");
  expect(fakes.notices).toEqual([]);
});

test("a run after the close keeps the volume", async () => {
  const fakes = setup();
  ten7(fakes);
  saveClose(fakes);
  saveRun(fakes, {
    task: "TEN-7",
    created: "2026-11-03T10:00:00.000Z",
    finished: "2026-11-03T11:00:00.000Z",
  });
  await pollOn(fakes, 6);
  expect(fakes.deletes).toEqual([]);
  expect(fakes.notices).toEqual([]);
});

test("a listed pod of the task keeps a closed volume", async () => {
  const fakes = setup();
  ten7(fakes);
  saveClose(fakes);
  fakes.podTasks = ["TEN-7"];
  await pollOn(fakes, 6);
  expect(fakes.deletes).toEqual([]);
  fakes.podTasks = ["TEN-8"];
  await pollOn(fakes, 6);
  expect(fakes.deletes).toEqual([TEN7_DELETE]);
});

test("a DELETE answered 404 counts as gone", async () => {
  const fakes = setup();
  ten7(fakes);
  saveClose(fakes);
  fakes.deleteStatuses = [HTTP_NOT_FOUND];
  const lines = await errorLines(() => pollOn(fakes, 6));
  expect(lines).toEqual([]);
  expect(fakes.deletes).toEqual([TEN7_DELETE]);
});

test("a failed DELETE is one stderr line and the next poll tries again", async () => {
  const fakes = setup();
  ten7(fakes);
  saveClose(fakes);
  fakes.deleteStatuses = [HTTP_SERVER_ERROR];
  const lines = await errorLines(() => pollOn(fakes, 6));
  expect(lines).toEqual([expect.stringMatching(/^volume watch: volume task-ten-7: .*HTTP 500/)]);
  await pollOn(fakes, 6);
  expect(fakes.deletes).toEqual([TEN7_DELETE, TEN7_DELETE]);
});

test("an idle open volume gives one notice", async () => {
  const fakes = setup();
  ten7(fakes);
  saveRun(fakes, {
    task: "TEN-7",
    created: "2026-11-02T09:00:00.000Z",
    finished: "2026-11-02T10:00:00.000Z",
  });
  await pollOn(fakes, 8);
  expect(fakes.notices).toEqual([]);
  await pollOn(fakes, 10);
  await pollOn(fakes, 11);
  expect(fakes.notices).toEqual([{ topic: NTFY_TOPIC, message: IDLE_LINE(8) }]);
  expect(fakes.deletes).toEqual([]);
  const [idle, ...rest] = idleRows(fakes);
  expect(rest).toEqual([]);
  expect(idle).toMatchObject({
    id: "volume.idle:pvc-uid-7:2026-11-02T10:00:00.000Z",
    subject: "task-ten-7",
    user_id: null,
    tenbox: "server",
    at: "2026-11-10T10:00:00.000Z",
  });
  expect(JSON.parse(idle?.body ?? "")).toEqual({
    event: "volume.idle",
    volume: "task-ten-7",
    uid: "pvc-uid-7",
    task: "TEN-7",
    since: "2026-11-02T10:00:00.000Z",
    days: 8,
  });
});

test("a new run after the notice and 7 more idle days gives one more notice", async () => {
  const fakes = setup();
  ten7(fakes);
  saveRun(fakes, {
    task: "TEN-7",
    created: "2026-11-01T09:00:00.000Z",
    finished: "2026-11-01T10:00:00.000Z",
  });
  await pollOn(fakes, 9);
  saveRun(fakes, {
    task: "TEN-7",
    created: "2026-11-11T09:00:00.000Z",
    finished: "2026-11-11T10:00:00.000Z",
  });
  await pollOn(fakes, 17);
  await pollOn(fakes, 18);
  await pollOn(fakes, 19);
  expect(fakes.notices).toEqual([
    { topic: NTFY_TOPIC, message: IDLE_LINE(8) },
    { topic: NTFY_TOPIC, message: IDLE_LINE(7) },
  ]);
  expect(idleRows(fakes)).toHaveLength(2);
});

test("without TENBOX_SERVER_NTFY no notice is sent and none stored", async () => {
  const fakes = setup();
  ten7(fakes);
  fakes.env.ntfy = null;
  const lines = await errorLines(async () => {
    await pollOn(fakes, 9);
    await pollOn(fakes, 9);
  });
  expect(lines).toEqual([
    "volume watch: 1 idle volume, no notice without TENBOX_SERVER_NTFY",
    "volume watch: 1 idle volume, no notice without TENBOX_SERVER_NTFY",
  ]);
  expect(fakes.notices).toEqual([]);
  expect(idleRows(fakes)).toEqual([]);
});

test("a failed notice is one stderr line and the next poll sends it again", async () => {
  const fakes = setup();
  ten7(fakes);
  fakes.ntfyStatuses = [HTTP_SERVER_ERROR];
  const lines = await errorLines(() => pollOn(fakes, 9));
  expect(lines).toEqual([expect.stringMatching(/^volume watch: volume task-ten-7: .*HTTP 500/)]);
  expect(idleRows(fakes)).toEqual([]);
  await pollOn(fakes, 9);
  expect(fakes.notices).toHaveLength(2);
  expect(idleRows(fakes)).toHaveLength(1);
});
