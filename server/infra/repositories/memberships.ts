import { and, eq } from "drizzle-orm";
import type { MembershipType } from "../../../domain/memberships.ts";
import type { Queryable } from "../db/index.ts";
import { memberships } from "../db/schema.ts";

export interface Membership {
  orgId: string;
  userId: string;
  type: MembershipType;
}

function insert(db: Queryable, membership: Membership): void {
  db.insert(memberships).values(membership).run();
}

function findAdmin(db: Queryable, userId: string): Membership | null {
  const where = and(eq(memberships.userId, userId), eq(memberships.type, "admin"));
  const row = db.select().from(memberships).where(where).get();
  return row ?? null;
}

export const membershipsRepository = { insert, findAdmin };
