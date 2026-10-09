import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectId } from "../../domain/ids.ts";
import { type Db, database } from "../infra/db/index.ts";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function tempDb(): Db {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-projects-"));
  roots.push(root);
  return database.open(path.join(root, "server.db"));
}

const TENBOX = {
  id: projectId("k7f3qa"),
  name: "tenbox",
  repo: "github.com/enojen/tenbox",
  org: "Acme",
};

interface CountRow {
  n: number;
}

function count(db: Db, table: string): number {
  const row = db.$client.query<CountRow, []>(`select count(*) as n from ${table}`).get();
  return row?.n ?? 0;
}

test("save makes the organization and one project row that points at it", () => {
  const db = tempDb();
  const saved = projects.save(db, TENBOX);
  expect(saved.project).toEqual({ id: "k7f3qa", name: "tenbox", repo: TENBOX.repo });
  expect(saved.organization.name).toBe("Acme");
  const row = db.$client.query("select id, org_id from projects").get();
  expect(row).toEqual({ id: "k7f3qa", org_id: saved.organization.id });
});

test("save reuses an organization that user add made", () => {
  const db = tempDb();
  users.save(db, {
    name: "Enes",
    github: "enojen",
    org: "Acme",
    email: undefined,
    type: "member",
  });
  projects.save(db, TENBOX);
  expect(count(db, "organizations")).toBe(1);
});

test("the same id twice fails with project-exists and keeps one row", () => {
  const db = tempDb();
  projects.save(db, TENBOX);
  expect(() => projects.save(db, { ...TENBOX, name: "other" })).toThrow(
    expect.objectContaining({ code: "project-exists", message: expect.stringContaining("k7f3qa") }),
  );
  expect(count(db, "projects")).toBe(1);
});
