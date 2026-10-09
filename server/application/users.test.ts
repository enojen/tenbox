import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Db, database } from "../infra/db/index.ts";
import { type NewUser, users } from "./users.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function tempDb(): Db {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-users-"));
  roots.push(root);
  return database.open(path.join(root, "server.db"));
}

const ENES: NewUser = {
  name: "Enes",
  github: "enojen",
  org: "Acme",
  email: undefined,
  type: "member",
};

interface CountRow {
  n: number;
}

function count(db: Db, table: string): number {
  const row = db.$client.query<CountRow, []>(`select count(*) as n from ${table}`).get();
  return row?.n ?? 0;
}

test("save makes one organization, user and membership and a tbx_ token", () => {
  const db = tempDb();
  const saved = users.save(db, ENES);
  expect(saved.token).toStartWith("tbx_");
  expect(saved.user.id).toMatch(/^u-[a-z0-9]{6}$/);
  expect(saved.organization.id).toMatch(/^o-[a-z0-9]{6}$/);
  expect(saved.type).toBe("member");
  expect([count(db, "organizations"), count(db, "users"), count(db, "memberships")]).toEqual([
    1, 1, 1,
  ]);
});

test("no column holds the plain token", () => {
  const db = tempDb();
  const { token } = users.save(db, ENES);
  const rows = db.$client.query("select * from users").all();
  expect(JSON.stringify(rows)).not.toContain(token);
});

test("save stores the type and reuses an organization found by name", () => {
  const db = tempDb();
  users.save(db, ENES);
  users.save(db, { ...ENES, github: "other", type: "admin" });
  expect(count(db, "organizations")).toBe(1);
  const row = db.$client.query("select type from memberships order by rowid desc").get();
  expect(row).toEqual({ type: "admin" });
});

test("the same github twice is user-exists and adds nothing", () => {
  const db = tempDb();
  users.save(db, ENES);
  let thrown: unknown = null;
  try {
    users.save(db, ENES);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code: "user-exists" });
  expect(count(db, "users")).toBe(1);
});

test("findByToken returns the user for a known token and null otherwise", () => {
  const db = tempDb();
  const { token, user } = users.save(db, ENES);
  expect(users.findByToken(db, token)?.id).toBe(user.id);
  expect(users.findByToken(db, "tbx_wrong")).toBeNull();
});

test("deleting a user removes its memberships", () => {
  const db = tempDb();
  users.save(db, ENES);
  db.$client.run("delete from users where github = ?", [ENES.github]);
  expect([count(db, "users"), count(db, "memberships")]).toEqual([0, 0]);
});
