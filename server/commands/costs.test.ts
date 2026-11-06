import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { type NodeEvent, nodeEventId } from "../../domain/events.ts";
import { database } from "../infra/db/index.ts";
import { eventsRepository } from "../infra/repositories/events.ts";

const MAIN = path.join(import.meta.dir, "..", "main.ts");
const WINDOW = ["--from", "2026-11-02T00:00:00Z", "--to", "2026-11-09T00:00:00Z"];
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

const ResultSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  error: z.string().optional(),
  workers: z.array(z.object({ node: z.string(), paid_hours: z.number(), eur: z.string() })),
  total: z.object({ paid_hours: z.number(), eur: z.string() }),
});

const FailureSchema = ResultSchema.partial().extend({ ok: z.boolean() });

function dbWithWorker(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-costs-cmd-"));
  roots.push(root);
  const file = path.join(root, "server.db");
  const db = database.open(file);
  const event: NodeEvent = {
    event: "node.added",
    node: "worker-1",
    server_id: 101,
    server_type: "cx22",
    location: "fsn1",
    price_hourly: { net: "0.0076", gross: "0.0090" },
  };
  eventsRepository.insert(db, {
    id: nodeEventId(event),
    type: event.event,
    subject: event.node,
    userId: null,
    tenbox: "server",
    at: "2026-11-03T10:20:00.000Z",
    body: JSON.stringify(event),
  });
  database.close(db);
  return file;
}

function run(dbFile: string, args: string[]) {
  const proc = Bun.spawnSync(["bun", "run", MAIN, "costs", ...args], {
    env: { ...process.env, TENBOX_SERVER_DB: dbFile },
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString() };
}

test("tenbox-server costs prints the report of a window", () => {
  const { code, stdout } = run(dbWithWorker(), WINDOW);
  const result = ResultSchema.parse(JSON.parse(stdout));
  expect(code).toBe(0);
  expect(result.ok).toBe(true);
  expect(result.workers.map((worker) => worker.node)).toEqual(["worker-1"]);
  expect(result.total.paid_hours).toBeGreaterThan(0);
});

test("tenbox-server costs without --to is a usage error", () => {
  const { code, stdout } = run(dbWithWorker(), ["--from", "2026-11-02T00:00:00Z"]);
  const result = FailureSchema.parse(JSON.parse(stdout));
  expect(code).toBe(1);
  expect(result.code).toBe("usage");
  expect(result.error).toContain("--to");
});

test("tenbox-server costs with from after to is bad input", () => {
  const { code, stdout } = run(dbWithWorker(), [
    "--from",
    "2026-11-09T00:00:00Z",
    "--to",
    "2026-11-02T00:00:00Z",
  ]);
  expect(code).toBe(1);
  expect(FailureSchema.parse(JSON.parse(stdout)).code).toBe("bad-input");
});

test("tenbox-server costs on a missing database creates none", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-costs-cmd-"));
  roots.push(root);
  const file = path.join(root, "none.db");
  const { code, stdout } = run(file, WINDOW);
  expect(code).toBe(1);
  expect(FailureSchema.parse(JSON.parse(stdout)).code).toBe("no-database");
  expect(fs.existsSync(file)).toBe(false);
});

test("tenbox-server costs applies no migration to the database it reads", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-costs-cmd-"));
  roots.push(root);
  const file = path.join(root, "old.db");
  const old = new Database(file, { create: true });
  old.run("create table kept (id text)");
  old.close();
  run(file, WINDOW);
  const after = new Database(file, { readonly: true });
  const tables = after.query("select name from sqlite_master where type = 'table'").all();
  after.close();
  expect(tables).toEqual([{ name: "kept" }]);
});
