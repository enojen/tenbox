import { eq } from "drizzle-orm";
import type { Queryable } from "../db/index.ts";
import { organizations } from "../db/schema.ts";

export interface Organization {
  id: string;
  name: string;
}

function findByName(db: Queryable, name: string): Organization | null {
  const row = db.select().from(organizations).where(eq(organizations.name, name)).get();
  return row ?? null;
}

function insert(db: Queryable, organization: Organization): void {
  db.insert(organizations).values(organization).run();
}

export const organizationsRepository = { findByName, insert };
