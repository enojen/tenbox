import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectId } from "../../domain/ids.ts";
import { type Db, database } from "../infra/db/index.ts";
import { projects } from "./projects.ts";
import { trackerKeys } from "./trackerKeys.ts";

const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const CLICKUP_KEY = "pk_123_secret";
const roots: string[] = [];
const dbs: Db[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) database.close(db);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

const DEMO = projectId("k7f3qa");
const OTHER = projectId("rsgjhl");

function tempDb(): Db {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-tracker-keys-"));
  roots.push(root);
  const db = database.open(path.join(root, "server.db"));
  dbs.push(db);
  projects.save(db, { id: DEMO, name: "demo", repo: "github.com/enojen/demo", org: "enojen" });
  projects.save(db, { id: OTHER, name: "other", repo: "github.com/enojen/other", org: "enojen" });
  return db;
}

interface StoredRow {
  tracker: string | null;
  tracker_key: string | null;
}

function stored(db: Db, id: string): StoredRow | null {
  const query = db.$client.query<StoredRow, [string]>(
    "select tracker, tracker_key from projects where id = ?",
  );
  return query.get(id);
}

function saveClickUp(db: Db): void {
  trackerKeys.update(db, {
    project: DEMO,
    tracker: "clickup",
    key: CLICKUP_KEY,
    encryptionKey: ENCRYPTION_KEY,
  });
}

test("update stores the key sealed on the project's row and prints no key", () => {
  const db = tempDb();
  const saved = trackerKeys.update(db, {
    project: DEMO,
    tracker: "clickup",
    key: CLICKUP_KEY,
    encryptionKey: ENCRYPTION_KEY,
  });
  expect(saved).toEqual({ project: DEMO, tracker: "clickup" });
  const row = stored(db, DEMO);
  expect(row?.tracker).toBe("clickup");
  expect(row?.tracker_key).not.toContain(CLICKUP_KEY);
  expect(stored(db, OTHER)).toEqual({ tracker: null, tracker_key: null });
});

test("update of a project the server does not know is an error", () => {
  const db = tempDb();
  const update = () =>
    trackerKeys.update(db, {
      project: projectId("zzzzzz"),
      tracker: "clickup",
      key: CLICKUP_KEY,
      encryptionKey: ENCRYPTION_KEY,
    });
  expect(update).toThrow(/zzzzzz/);
});

test("find gives the key of the project for its own tracker only", () => {
  const db = tempDb();
  saveClickUp(db);
  const find = { project: DEMO, encryptionKey: ENCRYPTION_KEY };
  expect(trackerKeys.find(db, { ...find, tracker: "clickup" })).toBe(CLICKUP_KEY);
  expect(trackerKeys.find(db, { ...find, tracker: "linear" })).toBeNull();
  expect(
    trackerKeys.find(db, { project: OTHER, tracker: "clickup", encryptionKey: ENCRYPTION_KEY }),
  ).toBeNull();
});

test("a second update replaces the key and the tracker", () => {
  const db = tempDb();
  saveClickUp(db);
  trackerKeys.update(db, {
    project: DEMO,
    tracker: "linear",
    key: "lin_api_new",
    encryptionKey: ENCRYPTION_KEY,
  });
  const find = { project: DEMO, encryptionKey: ENCRYPTION_KEY };
  expect(trackerKeys.find(db, { ...find, tracker: "linear" })).toBe("lin_api_new");
  expect(trackerKeys.find(db, { ...find, tracker: "clickup" })).toBeNull();
});

test("a sealed key moved to another project or read with another encryption key is an error", () => {
  const db = tempDb();
  saveClickUp(db);
  const row = stored(db, DEMO);
  db.$client
    .query("update projects set tracker = 'clickup', tracker_key = ? where id = ?")
    .run(row?.tracker_key ?? "", OTHER);
  const moved = () =>
    trackerKeys.find(db, { project: OTHER, tracker: "clickup", encryptionKey: ENCRYPTION_KEY });
  expect(moved).toThrow(/rsgjhl/);
  const otherKey = () =>
    trackerKeys.find(db, { project: DEMO, tracker: "clickup", encryptionKey: Buffer.alloc(32, 1) });
  expect(otherKey).toThrow(/k7f3qa/);
});
