import { eq } from "drizzle-orm";
import type { Queryable } from "../db/index.ts";
import { users } from "../db/schema.ts";

export interface User {
  id: string;
  name: string;
  email: string | null;
  github: string;
}

export interface UserRow extends User {
  tokenHash: string;
}

/** Every column but the token hash, which never leaves this file. */
const USER_COLUMNS = { id: users.id, name: users.name, email: users.email, github: users.github };

function findByGithub(db: Queryable, github: string): User | null {
  const row = db.select(USER_COLUMNS).from(users).where(eq(users.github, github)).get();
  return row ?? null;
}

function findByTokenHash(db: Queryable, tokenHash: string): User | null {
  const row = db.select(USER_COLUMNS).from(users).where(eq(users.tokenHash, tokenHash)).get();
  return row ?? null;
}

function insert(db: Queryable, row: UserRow): void {
  db.insert(users).values(row).run();
}

export const usersRepository = { findByGithub, findByTokenHash, insert };
