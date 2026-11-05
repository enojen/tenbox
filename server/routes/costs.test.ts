import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { type NodeEvent, nodeEventId } from "../../domain/events.ts";
import { users } from "../application/users.ts";
import { type Db, database } from "../infra/db/index.ts";
import { eventsRepository } from "../infra/repositories/events.ts";
import { createApp } from "./index.ts";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const WINDOW = "from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z";
const PRICE = { net: "0.0076", gross: "0.0090" };
const WORKER = { node: "worker-1", server_id: 101, server_type: "cx22", location: "fsn1" };
const ProblemSchema = z.object({ status: z.number(), code: z.string(), detail: z.string() });
const DocSchema = z.object({ paths: z.record(z.string(), z.unknown()) });

const roots: string[] = [];
const dbs: Db[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) database.close(db);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-costs-route-"));
  roots.push(root);
  const db = database.open(path.join(root, "server.db"));
  dbs.push(db);
  const saved = users.save(db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "member",
  });
  return { db, app: createApp(db), token: saved.token };
}

/** One node event as the node watch stores it. */
interface StoredEvent {
  event: NodeEvent;
  at: string;
}

function store(db: Db, stored: StoredEvent): void {
  const { event, at } = stored;
  eventsRepository.insert(db, {
    id: nodeEventId(event),
    type: event.event,
    subject: event.node,
    userId: null,
    tenbox: "server",
    at,
    body: JSON.stringify(event),
  });
}

function get(app: ReturnType<typeof createApp>, query: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return app.request(`/costs?${query}`, { headers });
}

test("GET /costs counts every started hour of a worker", async () => {
  const { db, app, token } = setup();
  store(db, {
    event: { event: "node.added", ...WORKER, price_hourly: PRICE },
    at: "2026-11-03T10:20:00.000Z",
  });
  store(db, {
    event: { event: "node.removed", ...WORKER, late: false },
    at: "2026-11-03T12:05:00.000Z",
  });
  const response = await get(app, WINDOW, token);
  expect(response.status).toBe(HTTP_OK);
  const body = await response.json();
  expect(body).toEqual({
    ok: true,
    from: "2026-11-02T00:00:00Z",
    to: "2026-11-09T00:00:00Z",
    workers: [{ ...WORKER, paid_hours: 2, eur: "0.02" }],
    total: { paid_hours: 2, eur: "0.02" },
  });
});

test("a worker still running at the end of the window is counted up to to", async () => {
  const { db, app, token } = setup();
  store(db, {
    event: { event: "node.added", ...WORKER, price_hourly: PRICE },
    at: "2026-11-08T22:30:00.000Z",
  });
  const response = await get(app, WINDOW, token);
  const body = await response.json();
  expect(body).toMatchObject({ workers: [{ server_id: 101, paid_hours: 2 }] });
});

test("GET /costs refuses a missing window", async () => {
  const { app, token } = setup();
  const missing = await get(app, "to=2026-11-09T00:00:00Z", token);
  expect(missing.status).toBe(HTTP_BAD_REQUEST);
  expect(missing.headers.get("content-type")).toStartWith("application/problem+json");
  const json = await missing.json();
  const problem = ProblemSchema.parse(json);
  expect(problem).toMatchObject({ status: HTTP_BAD_REQUEST, code: "bad-input" });
  expect(problem.detail).toContain("from");
  const noToken = await get(app, WINDOW);
  expect(noToken.status).toBe(HTTP_UNAUTHORIZED);
});

test("GET /costs refuses a from that is not before to", async () => {
  const { app, token } = setup();
  const reversed = await get(app, "from=2026-11-09T00:00:00Z&to=2026-11-02T00:00:00Z", token);
  expect(reversed.status).toBe(HTTP_BAD_REQUEST);
  const notADate = await get(app, "from=monday&to=2026-11-09T00:00:00Z", token);
  expect(notADate.status).toBe(HTTP_BAD_REQUEST);
});

test("GET /costs is in /openapi.json", async () => {
  const { app } = setup();
  const response = await app.request("/openapi.json");
  const json = await response.json();
  const doc = DocSchema.parse(json);
  expect(Object.keys(doc.paths)).toContain("/costs");
});
