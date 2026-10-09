import { userExistsError } from "../../domain/errors/users.ts";
import { newUserId } from "../../domain/ids.ts";
import type { MembershipType } from "../../domain/membership.ts";
import type { Db, Queryable } from "../infra/db/index.ts";
import { membershipsRepository } from "../infra/repositories/memberships.ts";
import type { Organization } from "../infra/repositories/organizations.ts";
import { type User, usersRepository } from "../infra/repositories/users.ts";
import { tokens } from "../infra/tokens.ts";
import { organizations } from "./organizations.ts";

export interface NewUser {
  name: string;
  email: string | undefined;
  github: string;
  org: string;
  type: MembershipType;
}

/** What `save` returns. `token` is the only time the plain token exists. */
export interface SavedUser {
  user: User;
  organization: Organization;
  type: MembershipType;
  token: string;
}

function save(db: Db, input: NewUser): SavedUser {
  assertNew(db, input.github);
  const token = tokens.make();
  const user: User = {
    id: newUserId(),
    name: input.name,
    email: input.email ?? null,
    github: input.github,
  };
  const organization = db.transaction((tx) => insert(tx, input, user, tokens.hash(token)));
  return { user, organization, type: input.type, token };
}

function assertNew(db: Queryable, github: string): void {
  const found = usersRepository.findByGithub(db, github);
  if (found !== null) throw userExistsError(github);
}

function insert(tx: Queryable, input: NewUser, user: User, tokenHash: string): Organization {
  const organization = organizations.ensure(tx, input.org);
  usersRepository.insert(tx, { ...user, tokenHash });
  membershipsRepository.insert(tx, { orgId: organization.id, userId: user.id, type: input.type });
  return organization;
}

function findByToken(db: Queryable, token: string): User | null {
  return usersRepository.findByTokenHash(db, tokens.hash(token));
}

/** Users: people on the server, each with one token. */
export const users = { save, findByToken };
