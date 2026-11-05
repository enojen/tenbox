import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "bun";
import { type Db, database } from "../infra/db/index.ts";
import type { HetznerApi } from "../infra/hetzner.ts";
import type { KubernetesApi } from "../infra/kubernetes.ts";
import { createApp } from "../routes/index.ts";
import { nodes } from "./nodes.ts";
import { users } from "./users.ts";

const TOKEN = "sa-token";
const HCLOUD_TOKEN = "hcloud-token";
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_REQUEST = 400;
const SERVER_ID = 42;
const CREATED = "2026-11-05T10:00:00+00:00";
const LEFT_AT = new Date("2026-11-05T12:00:30Z");
const STARTED_AT = new Date("2026-11-06T08:00:00Z");

/** One Node as the Kubernetes API lists it. */
interface FakeNode {
  name: string;
  providerID?: string;
}

/** The fake cluster and Hetzner: what they list, and how often Hetzner was asked. */
interface Fakes {
  db: Db;
  dbFile: string;
  listed: FakeNode[];
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

const HETZNER_SERVER = {
  server: {
    id: SERVER_ID,
    name: "worker-1",
    created: CREATED,
    server_type: {
      name: "cx22",
      prices: [
        {
          location: "nbg1",
          price_hourly: { net: "0.0070", gross: "0.0083" },
          price_monthly: { net: "4.0", gross: "4.76" },
        },
        {
          location: "fsn1",
          price_hourly: { net: "0.0076", gross: "0.0090" },
          price_monthly: { net: "4.5", gross: "5.36" },
        },
      ],
    },
    location: { name: "fsn1" },
  },
};

function bearer(request: Request, token: string): boolean {
  return request.headers.get("Authorization") === `Bearer ${token}`;
}

function setup(): Fakes {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-nodes-"));
  roots.push(root);
  const tokenFile = path.join(root, "token");
  const caFile = path.join(root, "ca.crt");
  fs.writeFileSync(tokenFile, `${TOKEN}\n`);
  fs.writeFileSync(caFile, "a CA");
  const dbFile = path.join(root, "server.db");
  const db = database.open(dbFile);
  dbs.push(db);
  const fakes: Fakes = {
    db,
    dbFile,
    listed: [{ name: "worker-1", providerID: `hcloud://${SERVER_ID}` }],
    hetznerCalls: 0,
    kubernetes: { url: "", tokenFile, caFile },
    hetzner: { url: "", token: HCLOUD_TOKEN },
  };
  const cluster = Bun.serve({
    port: 0,
    fetch: (request) => {
      if (!bearer(request, TOKEN)) return new Response("", { status: HTTP_UNAUTHORIZED });
      if (new URL(request.url).pathname !== "/api/v1/nodes") {
        return new Response("", { status: HTTP_NOT_FOUND });
      }
      const items = fakes.listed.map((node) => ({
        metadata: { name: node.name },
        spec: node.providerID === undefined ? {} : { providerID: node.providerID },
      }));
      return Response.json({ kind: "NodeList", items });
    },
  });
  const hetzner = Bun.serve({
    port: 0,
    fetch: (request) => {
      fakes.hetznerCalls += 1;
      if (!bearer(request, HCLOUD_TOKEN)) return new Response("", { status: HTTP_UNAUTHORIZED });
      if (new URL(request.url).pathname !== `/v1/servers/${SERVER_ID}`) {
        return new Response("", { status: HTTP_NOT_FOUND });
      }
      return Response.json(HETZNER_SERVER);
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
  return nodes.poll(fakes.db, {
    kubernetes: fakes.kubernetes,
    hetzner: fakes.hetzner,
    removedAt,
    late: false,
  });
}

test("stores node.added with type and price", async () => {
  const fakes = setup();
  await pollAt(fakes, LEFT_AT);
  const [row, ...rest] = rows(fakes.db);
  expect(rest).toEqual([]);
  expect(row).toMatchObject({
    id: "node.added:42",
    type: "node.added",
    subject: "worker-1",
    user_id: null,
    tenbox: "server",
    at: "2026-11-05T10:00:00.000Z",
  });
  expect(JSON.parse(row?.body ?? "")).toEqual({
    event: "node.added",
    node: "worker-1",
    server_id: SERVER_ID,
    server_type: "cx22",
    location: "fsn1",
    price_hourly: { net: "0.0076", gross: "0.0090" },
  });
});

test("stores node.removed when the node leaves", async () => {
  const fakes = setup();
  await pollAt(fakes, LEFT_AT);
  fakes.listed = [];
  await pollAt(fakes, LEFT_AT);
  const [, row, ...rest] = rows(fakes.db);
  expect(rest).toEqual([]);
  expect(row).toMatchObject({
    id: "node.removed:42",
    type: "node.removed",
    subject: "worker-1",
    user_id: null,
    tenbox: "server",
    at: "2026-11-05T12:00:30.000Z",
  });
  expect(JSON.parse(row?.body ?? "")).toEqual({
    event: "node.removed",
    node: "worker-1",
    server_id: SERVER_ID,
    server_type: "cx22",
    location: "fsn1",
    late: false,
  });
});

test("a restart writes no duplicate node events", async () => {
  const fakes = setup();
  await pollAt(fakes, LEFT_AT);
  database.close(fakes.db);
  fakes.db = database.open(fakes.dbFile);
  dbs.splice(0, 1, fakes.db);
  await pollAt(fakes, LEFT_AT);
  const added = rows(fakes.db).filter((row) => row.type === "node.added");
  expect(added.map((row) => row.id)).toEqual(["node.added:42"]);
  expect(fakes.hetznerCalls).toBe(1);
});

test("a node removed while the server was down is recorded late at start", async () => {
  const fakes = setup();
  await pollAt(fakes, LEFT_AT);
  fakes.listed = [];
  const watching = nodes.watch(fakes.db, {
    kubernetes: fakes.kubernetes,
    hetzner: fakes.hetzner,
    now: () => STARTED_AT,
  });
  await watching.stop();
  const removed = rows(fakes.db).filter((row) => row.type === "node.removed");
  expect(removed).toHaveLength(1);
  expect(removed[0]?.at).toBe("2026-11-06T08:00:00.000Z");
  expect(JSON.parse(removed[0]?.body ?? "")).toMatchObject({ node: "worker-1", late: true });
});

test("a node without an hcloud providerID is not recorded", async () => {
  const fakes = setup();
  fakes.listed = [{ name: "control-1" }, { name: "robot-1", providerID: "hrobot://7" }];
  await pollAt(fakes, LEFT_AT);
  expect(rows(fakes.db)).toEqual([]);
  expect(fakes.hetznerCalls).toBe(0);
});

test("a server Hetzner does not know is skipped and asked again on the next poll", async () => {
  const fakes = setup();
  fakes.listed = [
    { name: "worker-9", providerID: "hcloud://9" },
    { name: "worker-1", providerID: `hcloud://${SERVER_ID}` },
  ];
  await pollAt(fakes, LEFT_AT);
  expect(rows(fakes.db).map((row) => row.id)).toEqual(["node.added:42"]);
  await pollAt(fakes, LEFT_AT);
  expect(fakes.hetznerCalls).toBe(3);
});

test("node events cannot be posted", async () => {
  const fakes = setup();
  const saved = users.save(fakes.db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "member",
  });
  const event = {
    id: "node.added:42",
    schema: 1,
    event: "node.added",
    user: "u-4k2m7a",
    tenbox: "server",
    at: "2026-11-05T10:00:00Z",
    sent_at: "2026-11-05T10:00:05Z",
    node: "worker-1",
    server_id: SERVER_ID,
    server_type: "cx22",
    location: "fsn1",
    price_hourly: { net: "0.0076", gross: "0.0090" },
  };
  const response = await createApp(fakes.db).request("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${saved.token}` },
    body: JSON.stringify([event]),
  });
  expect(response.status).toBe(HTTP_BAD_REQUEST);
  const problem = await response.json();
  expect(problem).toMatchObject({ code: "bad-input" });
  expect(rows(fakes.db)).toEqual([]);
});
