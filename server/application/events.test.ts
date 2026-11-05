import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Event, EventSchema } from "../../domain/events.ts";
import { type Db, database } from "../infra/db/index.ts";
import { events } from "./events.ts";
import { users } from "./users.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function setup(): { db: Db; userId: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-events-"));
  roots.push(root);
  const db = database.open(path.join(root, "server.db"));
  const saved = users.save(db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "member",
  });
  return { db, userId: saved.user.id };
}

function event(id: string): Event {
  return EventSchema.parse({
    id,
    schema: 1,
    event: "plan.approved",
    task: "k7f3qa/TEN-301",
    plan_sha: "a".repeat(64),
    user: "u-unknown",
    tenbox: "9d90eeb",
    at: "2026-10-08T10:00:00Z",
    sent_at: "2026-10-08T10:00:05Z",
  });
}

interface Row {
  id: string;
  type: string;
  subject: string;
  user_id: string;
  body: string;
}

function rows(db: Db): Row[] {
  return db.$client.query<Row, []>("select * from events").all();
}

test("save stores one row per new event with the token user and the body", () => {
  const { db, userId } = setup();
  const sent = event("wf_1/a1/plan.approved");
  expect(events.save(db, { userId, events: [sent] })).toEqual({ stored: 1, skipped: 0 });
  const [row] = rows(db);
  expect(row).toMatchObject({
    id: "wf_1/a1/plan.approved",
    type: "plan.approved",
    subject: "k7f3qa/TEN-301",
    user_id: userId,
  });
  expect(JSON.parse(row?.body ?? "")).toEqual(sent);
});

test("save skips an id it has, also twice in one list", () => {
  const { db, userId } = setup();
  const sent = event("wf_1/a1/plan.approved");
  expect(events.save(db, { userId, events: [sent, sent] })).toEqual({ stored: 1, skipped: 1 });
  expect(events.save(db, { userId, events: [sent] })).toEqual({ stored: 0, skipped: 1 });
  expect(rows(db)).toHaveLength(1);
});
