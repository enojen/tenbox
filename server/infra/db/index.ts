import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { backupExistsError, noDatabaseError } from "../../../domain/errors/backups.ts";

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
  from: string;
  to: string;
}

/**
 * A consistent copy of the live database, safe while it is written; never overwrites a file.
 * It opens the database read-only and applies no migration, so a newer image never changes
 * the schema of the database an older server runs on.
 */
function backup(input: BackupInput): void {
  const { from, to } = input;
  if (!fs.existsSync(from)) throw noDatabaseError(from);
  if (fs.existsSync(to)) throw backupExistsError(to);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const client = new Database(from, { readonly: true });
  try {
    client.run("vacuum into ?", [to]);
  } finally {
    client.close();
  }
}

export const database = { open, close, backup };
