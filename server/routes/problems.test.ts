import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { users } from "../application/users.ts";
import { database } from "../infra/db/index.ts";
import { createApp } from "./index.ts";

const PROBLEM_TYPE = "application/problem+json";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-problems-"));
  roots.push(root);
  const db = database.open(path.join(root, "server.db"));
  const { token } = users.save(db, { name: "Enes", github: "enojen", org: "W", type: "member" });
  return { db, app: createApp(db), auth: { Authorization: `Bearer ${token}` } };
}

test("no token is a 401 problem", async () => {
  const { app } = setup();
  const response = await app.request("/nope");
  const body = await response.json();
  expect(response.status).toBe(401);
  expect(response.headers.get("content-type")).toStartWith(PROBLEM_TYPE);
  expect(body).toMatchObject({
    type: "about:blank",
    title: "Unauthorized",
    status: 401,
    code: "unauthorized",
  });
});

test("an unknown path is a 404 problem", async () => {
  const { app, auth } = setup();
  const response = await app.request("/nope", { headers: auth });
  const body = await response.json();
  expect(response.headers.get("content-type")).toStartWith(PROBLEM_TYPE);
  expect(body).toMatchObject({ title: "Not Found", status: 404, code: "not-found" });
});

test("an unexpected error is a 500 problem that hides its message", async () => {
  const { db, app, auth } = setup();
  database.close(db);
  const response = await app.request("/nope", { headers: auth });
  const text = await response.text();
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toStartWith(PROBLEM_TYPE);
  expect(JSON.parse(text)).toMatchObject({ title: "Internal Server Error", status: 500 });
  expect(text).not.toContain("closed");
});
