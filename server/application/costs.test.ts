import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Db, database } from "../infra/db/index.ts";
import { eventsRepository } from "../infra/repositories/events.ts";
import { costs } from "./costs.ts";

const WINDOW = { from: "2026-11-02T00:00:00Z", to: "2026-11-09T00:00:00Z" };
const ADDED = {
  event: "node.added",
  node: "worker-1",
  server_id: 101,
  server_type: "cx22",
  location: "fsn1",
  price_hourly: { net: "0.0076", gross: "0.0090" },
};

const roots: string[] = [];
const dbs: Db[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) database.close(db);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function open(): Db {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-costs-"));
  roots.push(root);
  const db = database.open(path.join(root, "server.db"));
  dbs.push(db);
  return db;
}

/** One events row of the node watch. */
interface Row {
  id: string;
  type: string;
  at: string;
  body: string;
}

function insert(db: Db, row: Row): void {
  eventsRepository.insert(db, { ...row, subject: "worker-1", userId: null, tenbox: "server" });
}

test("the report reads the node events with the at of their rows", () => {
  const db = open();
  insert(db, {
    id: "node.added:101",
    type: "node.added",
    at: "2026-11-03T10:00:00.000Z",
    body: JSON.stringify(ADDED),
  });
  insert(db, { id: "other", type: "plan.approved", at: "2026-11-03T10:00:00Z", body: "{}" });
  const report = costs.get(db, WINDOW);
  expect(report.workers).toMatchObject([{ server_id: 101, paid_hours: 134, eur: "1.02" }]);
});

test("a stored node event that does not fit its schema is a bad file", () => {
  const db = open();
  insert(db, { id: "node.added:101", type: "node.added", at: "2026-11-03T10:00:00Z", body: "{}" });
  expect(() => costs.get(db, WINDOW)).toThrow("event node.added:101");
});

test("the report splits busy EUR over the tasks of the stored job.finished events", () => {
  const db = open();
  insert(db, {
    id: "node.added:101",
    type: "node.added",
    at: "2026-11-03T10:00:00.000Z",
    body: JSON.stringify(ADDED),
  });
  const finished = {
    event: "job.finished",
    task: "TEN-7",
    project: "tenbox",
    job: "task-ten-7",
    pod: "task-ten-7-abc",
    command: "build",
    class: "build",
    node: "worker-1",
    exit_code: 0,
    oom: false,
    created: "2026-11-03T10:00:00.000Z",
    scheduled: "2026-11-03T10:00:00.000Z",
    started: "2026-11-03T10:00:00.000Z",
    finished: "2026-11-03T12:00:00.000Z",
    duration_ms: 7_200_000,
    requests: { cpu: "1", memory: "2Gi" },
  };
  insert(db, {
    id: "job.finished:uid-1",
    type: "job.finished",
    at: finished.finished,
    body: JSON.stringify(finished),
  });
  const report = costs.get(db, WINDOW);
  expect(report.workers).toMatchObject([{ server_id: 101, busy_hours: 2, waste_hours: 132 }]);
  expect(report.tasks).toEqual([
    { task: "TEN-7", workers: [{ node: "worker-1", server_id: 101, eur: "0.02" }], eur: "0.02" },
  ]);
});

test("a stored job.finished that does not fit its schema is a bad file", () => {
  const db = open();
  insert(db, {
    id: "job.finished:uid-1",
    type: "job.finished",
    at: "2026-11-03T10:00:00Z",
    body: "{}",
  });
  expect(() => costs.get(db, WINDOW)).toThrow("event job.finished:uid-1");
});
