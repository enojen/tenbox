import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

/** Opens the database file, creating its folder and the file when missing. */
function open(file: string): Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return new Database(file, { create: true });
}

export const sqlite = { open };
