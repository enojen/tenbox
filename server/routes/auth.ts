import type { MiddlewareHandler } from "hono";
import { unauthorizedError } from "../../domain/errors/auth.ts";
import { users } from "../application/users.ts";
import type { Db } from "../infra/db/index.ts";

const BEARER_PREFIX = "Bearer ";
const OPEN_PATHS = new Set(["/health", "/openapi.json", "/docs"]);

export function requireToken(db: Db): MiddlewareHandler {
  return (c, next) => {
    if (OPEN_PATHS.has(c.req.path)) return next();
    const token = bearerToken(c.req.header("Authorization"));
    if (token === null) throw unauthorizedError();
    const user = users.findByToken(db, token);
    if (user === null) throw unauthorizedError();
    return next();
  };
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length);
  return token === "" ? null : token;
}
