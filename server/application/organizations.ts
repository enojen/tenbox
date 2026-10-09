import { newOrganizationId } from "../../domain/ids.ts";
import type { Queryable } from "../infra/db/index.ts";
import { type Organization, organizationsRepository } from "../infra/repositories/organizations.ts";

function ensure(db: Queryable, name: string): Organization {
  const found = organizationsRepository.findByName(db, name);
  if (found !== null) return found;
  const organization = { id: newOrganizationId(), name };
  organizationsRepository.insert(db, organization);
  return organization;
}

/** Organizations: groups of users on the server, found by name. */
export const organizations = { ensure };
