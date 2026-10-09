import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sqlite } from "./sqlite.ts";

const SQLITE_HEADER = "SQLite format 3";

test("open creates the parent folder and the database file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-sqlite-"));
  try {
    const file = path.join(root, "nested", "server.db");
    const db = sqlite.open(file);
    db.run("create table t (id integer)");
    db.close();
    const header = fs.readFileSync(file).subarray(0, SQLITE_HEADER.length).toString();
    expect(header).toBe(SQLITE_HEADER);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
