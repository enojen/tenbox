import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { users } from "../application/users.ts";
import { database } from "../infra/db/index.ts";
import { createApp } from "./index.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-auth-"));
  roots.push(root);
  const db = database.open(path.join(root, "server.db"));
  const { token } = users.save(db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "member",
  });
  return { app: createApp(db), token };
}

test("a valid token passes: an unknown path is 404", async () => {
  const { app, token } = setup();
  const response = await app.request("/nope", { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(404);
});

test("no header is 401 unauthorized", async () => {
  const { app } = setup();
  const response = await app.request("/nope");
  expect(response.status).toBe(401);
  const body = await response.json();
  expect(body).toMatchObject({ status: 401, code: "unauthorized" });
});

test("a wrong token and a header without Bearer are 401", async () => {
  const { app, token } = setup();
  const wrong = await app.request("/nope", { headers: { Authorization: "Bearer tbx_wrong" } });
  expect(wrong.status).toBe(401);
  const noScheme = await app.request("/nope", { headers: { Authorization: token } });
  expect(noScheme.status).toBe(401);
});

test("/health, /openapi.json and /docs need no token", async () => {
  const { app } = setup();
  for (const url of ["/health", "/openapi.json", "/docs"]) {
    const response = await app.request(url);
    expect(response.status).toBe(200);
  }
});
