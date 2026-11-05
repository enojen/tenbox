import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { backupExistsError } from "../../../domain/errors/backups.ts";

const MIGRATIONS_DIR = path.join(import.meta.dir, "migrations");

export type Db = BunSQLiteDatabase & { $client: Database };
/** A database or a transaction on it: what a repository function needs. */
export type Queryable = BaseSQLiteDatabase<"sync", void>;

/** Opens the database file, creating its folder and the file, and applies new migrations. */
function open(file: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const client = new Database(file, { create: true });
  client.run("pragma foreign_keys = on");
  const db = drizzle({ client });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function close(db: Db): void {
  db.$client.close();
}

interface BackupInput {
  db: Db;
  file: string;
}

/** A consistent copy of the live database, safe while it is written; never overwrites a file. */
function backup(input: BackupInput): void {
  const { db, file } = input;
  if (fs.existsSync(file)) throw backupExistsError(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db.$client.run("vacuum into ?", [file]);
}

export const database = { open, close, backup };
