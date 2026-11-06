import type { MiddlewareHandler } from "hono";
import { forbiddenError, unauthorizedError } from "../../domain/errors/auth.ts";
import { memberships } from "../application/memberships.ts";
import { users } from "../application/users.ts";
import type { Db } from "../infra/db/index.ts";
import type { User } from "../infra/repositories/users.ts";

/** The Hono environment of a request after `requireToken`: the user of its token. */
export interface AuthEnv {
  Variables: { user: User };
}

const BEARER_PREFIX = "Bearer ";
const OPEN_PATHS = new Set(["/health", "/metrics", "/openapi.json", "/docs"]);

export function requireToken(db: Db): MiddlewareHandler<AuthEnv> {
  return (c, next) => {
    if (OPEN_PATHS.has(c.req.path)) return next();
    const token = bearerToken(c.req.header("Authorization"));
    if (token === null) throw unauthorizedError();
    const user = users.findByToken(db, token);
    if (user === null) throw unauthorizedError();
    c.set("user", user);
    return next();
  };
}

/** Cluster-wide data, such as the costs of every project, is for an organization admin only. */
export function requireAdmin(db: Db, user: User, what: string): void {
  if (memberships.findAdmin(db, user.id) === null) throw forbiddenError(what);
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length);
  return token === "" ? null : token;
}
