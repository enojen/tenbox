import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "bun";
import { runPlaceholder } from "../../domain/runTokens.ts";
import type { RunTokenWatch } from "../application/runTokens.ts";
import { users } from "../application/users.ts";
import { type Db, database } from "../infra/db/index.ts";
import { createApp } from "./index.ts";

const INJECTOR_TOKEN = "injector-token";
const KEY = "run-credential-key";
const CACHED = "ghs_cached";
const NOW = new Date("2026-11-08T17:00:00Z");
const JOB = { name: "task-demo-1-1108-170000", uid: "job-uid-1", projectId: "k7f3qa" };
const PLACEHOLDER = runPlaceholder(KEY, JOB.uid);
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

const roots: string[] = [];
const servers: Server<undefined>[] = [];
const dbs: Db[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) database.close(db);
  for (const server of servers.splice(0)) server.stop(true);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function jobList(): Response {
  const metadata = {
    name: JOB.name,
    uid: JOB.uid,
    labels: { app: "tenyard", task: "DEMO-1", "project-id": JOB.projectId },
  };
  return Response.json({ kind: "JobList", items: [{ metadata, status: {} }] });
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-run-credentials-"));
  roots.push(root);
  const tokenFile = path.join(root, "token");
  const caFile = path.join(root, "ca.crt");
  fs.writeFileSync(tokenFile, "sa-token\n");
  fs.writeFileSync(caFile, "a CA");
  const db = database.open(path.join(root, "server.db"));
  dbs.push(db);
  const cluster = Bun.serve({ port: 0, fetch: jobList });
  servers.push(cluster);
  const watch: RunTokenWatch = {
    kubernetes: { url: cluster.url.origin, tokenFile, caFile },
    github: { url: "http://127.0.0.1:1", appId: "1", key: "" },
    key: KEY,
    encryptionKey: Buffer.alloc(32),
    now: () => NOW,
    tokens: new Map([[JOB.uid, { token: CACHED, expiresAt: "2026-11-08T18:00:00Z" }]]),
  };
  const { token } = users.save(db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "admin",
  });
  return { db, watch, userToken: token };
}

function ask(app: ReturnType<typeof createApp>, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return app.request("/run-credentials", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("the injector's token and the placeholder of an open Job give its value", async () => {
  const { db, watch } = setup();
  const app = createApp(db, { watch, injectorToken: INJECTOR_TOKEN });
  const response = await ask(app, { placeholder: PLACEHOLDER, host: "github.com" }, INJECTOR_TOKEN);
  expect(response.status).toBe(HTTP_OK);
  const body = await response.json();
  expect(body).toEqual({ ok: true, value: CACHED });
});

test("an unknown placeholder or another host is a 404 problem", async () => {
  const { db, watch } = setup();
  const app = createApp(db, { watch, injectorToken: INJECTOR_TOKEN });
  const asked = [
    { placeholder: runPlaceholder(KEY, "job-uid-2"), host: "github.com" },
    { placeholder: PLACEHOLDER, host: "api.linear.app" },
  ];
  for (const body of asked) {
    const response = await ask(app, body, INJECTOR_TOKEN);
    expect(response.status).toBe(HTTP_NOT_FOUND);
    const problem = await response.json();
    expect(problem).toMatchObject({ code: "run-credential-not-found" });
  }
});

test("a user's token or no token is 401, also for an admin", async () => {
  const { db, watch, userToken } = setup();
  const app = createApp(db, { watch, injectorToken: INJECTOR_TOKEN });
  const body = { placeholder: PLACEHOLDER, host: "github.com" };
  const asUser = await ask(app, body, userToken);
  expect(asUser.status).toBe(HTTP_UNAUTHORIZED);
  const asNobody = await ask(app, body);
  expect(asNobody.status).toBe(HTTP_UNAUTHORIZED);
});

test("the injector's token opens no other route", async () => {
  const { db, watch } = setup();
  const app = createApp(db, { watch, injectorToken: INJECTOR_TOKEN });
  const response = await app.request("/tasks/DEMO-1/runs", {
    headers: { Authorization: `Bearer ${INJECTOR_TOKEN}` },
  });
  expect(response.status).toBe(HTTP_UNAUTHORIZED);
});

test("without run credentials there is no such route, also for a user", async () => {
  const { db, userToken } = setup();
  const app = createApp(db);
  const body = { placeholder: PLACEHOLDER, host: "github.com" };
  const asInjector = await ask(app, body, INJECTOR_TOKEN);
  expect(asInjector.status).toBe(HTTP_UNAUTHORIZED);
  const response = await ask(app, body, userToken);
  expect(response.status).toBe(HTTP_NOT_FOUND);
  const problem = await response.json();
  expect(problem).toMatchObject({ code: "not-found" });
});
