import type { MembershipType } from "../../../domain/membership.ts";
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

export const membershipsRepository = { insert };
