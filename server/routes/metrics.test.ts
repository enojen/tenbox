import { afterEach, expect, test } from "bun:test";
import {
  type NodeEvent,
  nodeEventId,
  type VolumeEvent,
  volumeEventId,
} from "../../domain/events.ts";
import { type Db, database } from "../infra/db/index.ts";
import { eventsRepository } from "../infra/repositories/events.ts";
import { createApp } from "./index.ts";

const HTTP_OK = 200;
const PRICE = { net: "0.0076", gross: "0.0090" };
const WORKER_1 = { node: "worker-1", server_id: 101, server_type: "cx22", location: "fsn1" };
const WORKER_2 = { node: "worker-2", server_id: 102, server_type: "cx32", location: "nbg1" };
const HELP = "# HELP tenbox_node_price_eur_hourly";
const TYPE = "# TYPE tenbox_node_price_eur_hourly gauge";
const VOLUME_HELP = "# HELP tenbox_volume_price_eur_hourly";
const VOLUME_TYPE = "# TYPE tenbox_volume_price_eur_hourly gauge";
const GB_MONTH = { net: "0.0720", gross: "0.0857" };
const VOLUME_7 = { volume: "task-7", uid: "uid-7", task: "7", size_gb: 10 };
const VOLUME_8 = { volume: "task-8", uid: "uid-8", task: "8", size_gb: 10 };

const dbs: Db[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) database.close(db);
});

function setup() {
  const db = database.open(":memory:");
  dbs.push(db);
  return { db, app: createApp(db) };
}

function store(db: Db, event: NodeEvent | VolumeEvent): void {
  const isNode = "node" in event;
  eventsRepository.insert(db, {
    id: isNode ? nodeEventId(event) : volumeEventId(event),
    type: event.event,
    subject: isNode ? event.node : event.volume,
    userId: null,
    tenbox: "server",
    at: "2026-11-03T10:20:00.000Z",
    body: JSON.stringify(event),
  });
}

test("GET /metrics returns one series for the worker that is up", async () => {
  const { db, app } = setup();
  store(db, { event: "node.added", ...WORKER_1, price_hourly: PRICE });
  store(db, { event: "node.added", ...WORKER_2, price_hourly: PRICE });
  store(db, { event: "node.removed", ...WORKER_2, late: false });
  const response = await app.request("/metrics");
  expect(response.status).toBe(HTTP_OK);
  expect(response.headers.get("content-type")).toBe("text/plain; version=0.0.4");
  const text = await response.text();
  const lines = text.trimEnd().split("\n");
  expect(lines[0]).toStartWith(HELP);
  expect(lines[1]).toBe(TYPE);
  expect(lines.slice(2, 3)).toEqual([
    'tenbox_node_price_eur_hourly{node="worker-1",server_type="cx22",location="fsn1"} 0.0076',
  ]);
});

test("GET /metrics returns one series for the task volume that is up", async () => {
  const { db, app } = setup();
  store(db, { event: "volume.added", ...VOLUME_7, price_per_gb_month: GB_MONTH });
  store(db, { event: "volume.added", ...VOLUME_8, price_per_gb_month: GB_MONTH });
  store(db, { event: "volume.removed", ...VOLUME_8, late: false });
  const response = await app.request("/metrics");
  const text = await response.text();
  const lines = text.trimEnd().split("\n");
  expect(lines.slice(2)).toEqual([
    `${VOLUME_HELP} Hourly list price in EUR of a task volume that is up.`,
    VOLUME_TYPE,
    'tenbox_volume_price_eur_hourly{volume="task-7",task="7",size_gb="10"} 0.001',
  ]);
});

test("GET /metrics with no node or volume events has no series", async () => {
  const { app } = setup();
  const response = await app.request("/metrics");
  expect(response.status).toBe(HTTP_OK);
  const text = await response.text();
  const lines = text.trimEnd().split("\n");
  expect(lines).toHaveLength(4);
  expect(lines[0]).toStartWith(HELP);
  expect(lines[1]).toBe(TYPE);
  expect(lines[2]).toStartWith(VOLUME_HELP);
  expect(lines[3]).toBe(VOLUME_TYPE);
});

test("GET /openapi.json does not list /metrics", async () => {
  const { app } = setup();
  const response = await app.request("/openapi.json");
  const body = await response.text();
  expect(body).toContain("/health");
  expect(body).not.toContain("/metrics");
});
