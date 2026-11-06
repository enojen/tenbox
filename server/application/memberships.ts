import type { Queryable } from "../infra/db/index.ts";
import { type Membership, membershipsRepository } from "../infra/repositories/memberships.ts";

/** One organization where the user is an admin, or null when the user is a member only. */
function findAdmin(db: Queryable, userId: string): Membership | null {
  return membershipsRepository.findAdmin(db, userId);
}

/** Memberships: which organizations a user is in, and as what. */
export const memberships = { findAdmin };
