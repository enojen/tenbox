import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { database } from "./index.ts";

const SQLITE_HEADER = "SQLite format 3";

interface NameRow {
  name: string;
}

function tableNames(file: string): string[] {
  const db = database.open(file);
  const rows = db.$client
    .query<NameRow, []>("select name from sqlite_master where type = 'table' order by name")
    .all();
  database.close(db);
  return rows.map((row) => row.name);
}

test("open creates the folder and the file and applies the migrations once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-db-"));
  try {
    const file = path.join(root, "nested", "server.db");
    const first = tableNames(file);
    const second = tableNames(file);
    const header = fs.readFileSync(file).subarray(0, SQLITE_HEADER.length).toString();
    expect(header).toBe(SQLITE_HEADER);
    expect(first).toEqual(
      expect.arrayContaining(["memberships", "organizations", "users", "__drizzle_migrations"]),
    );
    expect(second).toEqual(first);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
