import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "bun";
import { type Db, database } from "../infra/db/index.ts";
import type { HetznerApi } from "../infra/hetzner.ts";
import type { KubernetesApi } from "../infra/kubernetes.ts";
import { createApp } from "../routes/index.ts";
import { users } from "./users.ts";
import { volumes } from "./volumes.ts";

const TOKEN = "sa-token";
const HCLOUD_TOKEN = "hcloud-token";
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_REQUEST = 400;
const PVCS_PATH = "/api/v1/namespaces/tenbox/persistentvolumeclaims";
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
}

/** The fake cluster and Hetzner: what they list, and how often Hetzner was asked. */
interface Fakes {
  db: Db;
  listed: FakePvc[];
  hetznerCalls: number;
  kubernetes: KubernetesApi;
  hetzner: HetznerApi;
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

function bearer(request: Request, token: string): boolean {
  return request.headers.get("Authorization") === `Bearer ${token}`;
}

function pvcItem(pvc: FakePvc): unknown {
  return {
    metadata: {
      name: pvc.name,
      uid: pvc.uid,
      creationTimestamp: "2026-11-05T10:00:00Z",
      labels: { app: "tenyard", task: pvc.task },
    },
    spec: { resources: { requests: { storage: "10Gi" } } },
    status:
      pvc.storage === undefined
        ? { phase: pvc.phase }
        : { phase: pvc.phase, capacity: { storage: pvc.storage } },
  };
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
  };
  const cluster = Bun.serve({
    port: 0,
    fetch: (request) => {
      if (!bearer(request, TOKEN)) return new Response("", { status: HTTP_UNAUTHORIZED });
      const url = new URL(request.url);
      if (url.pathname !== PVCS_PATH || url.searchParams.get("labelSelector") !== "app=tenyard") {
        return new Response("", { status: HTTP_NOT_FOUND });
      }
      return Response.json({ kind: "PersistentVolumeClaimList", items: fakes.listed.map(pvcItem) });
    },
  });
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
  servers.push(cluster, hetzner);
  fakes.kubernetes.url = `http://127.0.0.1:${cluster.port}`;
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

function pollAt(fakes: Fakes, removedAt: Date): Promise<void> {
  return volumes.poll(fakes.db, {
    kubernetes: fakes.kubernetes,
    hetzner: fakes.hetzner,
    removedAt,
    late: false,
  });
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
