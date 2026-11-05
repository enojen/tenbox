import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { users } from "../application/users.ts";
import { type Db, database } from "../infra/db/index.ts";
import { createApp } from "./index.ts";

const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  code: z.string(),
  detail: z.string(),
});
const DocSchema = z.object({ paths: z.record(z.string(), z.unknown()) });
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-events-route-"));
  roots.push(root);
  const db = database.open(path.join(root, "server.db"));
  const saved = users.save(db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "member",
  });
  return { db, app: createApp(db), userId: saved.user.id, token: saved.token };
}

const EVENT = {
  id: "wf_1/a1/plan.approved",
  schema: 1,
  event: "plan.approved",
  task: "k7f3qa/TEN-301",
  plan_sha: "a".repeat(64),
  user: "u-4k2m7a",
  tenbox: "9d90eeb",
  at: "2026-10-08T10:00:00Z",
  sent_at: "2026-10-08T10:00:05Z",
};

function post(app: ReturnType<typeof createApp>, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return app.request("/events", { method: "POST", headers, body: JSON.stringify(body) });
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

test("POST /events stores a new event", async () => {
  const { db, app, token, userId } = setup();
  const response = await post(app, [EVENT], token);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ ok: true, stored: 1, skipped: 0 });
  const [row] = rows(db);
  expect(row).toMatchObject({
    id: EVENT.id,
    type: "plan.approved",
    subject: "k7f3qa/TEN-301",
    user_id: userId,
  });
  expect(JSON.parse(row?.body ?? "")).toEqual(EVENT);
});

test("the same event sent twice is stored once", async () => {
  const { db, app, token } = setup();
  await post(app, [EVENT], token);
  const again = await post(app, [EVENT], token);
  const againBody = await again.json();
  expect(againBody).toEqual({ ok: true, stored: 0, skipped: 1 });
  const twice = await post(
    app,
    [
      { ...EVENT, id: "other" },
      { ...EVENT, id: "other" },
    ],
    token,
  );
  const twiceBody = await twice.json();
  expect(twiceBody).toEqual({ ok: true, stored: 1, skipped: 1 });
  expect(rows(db)).toHaveLength(2);
});

test("a bad event is a 400 problem and nothing is stored", async () => {
  const { db, app, token } = setup();
  const response = await post(app, [EVENT, { ...EVENT, id: "b", at: "yesterday" }], token);
  expect(response.status).toBe(400);
  expect(response.headers.get("content-type")).toStartWith("application/problem+json");
  const json = await response.json();
  const body = ProblemSchema.parse(json);
  expect(body).toMatchObject({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    code: "bad-input",
  });
  expect(body.detail).toContain("1.at");
  expect(rows(db)).toHaveLength(0);
});

test("POST /events needs a token", async () => {
  const { db, app } = setup();
  const response = await post(app, [EVENT]);
  expect(response.status).toBe(401);
  expect(rows(db)).toHaveLength(0);
});

test("POST /events is in /openapi.json", async () => {
  const { app } = setup();
  const response = await app.request("/openapi.json");
  const json = await response.json();
  const doc = DocSchema.parse(json);
  expect(Object.keys(doc.paths)).toContain("/events");
});
