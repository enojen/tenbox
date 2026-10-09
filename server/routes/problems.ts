import { STATUS_CODES } from "node:http";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { TenboxError } from "../../domain/errors/index.ts";

/* Every error response is an RFC 9457 problem: `application/problem+json`. */

const PROBLEM_CONTENT_TYPE = "application/problem+json";
/** RFC 9457: no own type URI; `title` is then the HTTP status phrase. */
const BLANK_TYPE = "about:blank";
const UNAUTHORIZED_STATUS = 401;
const NOT_FOUND_STATUS = 404;
const INTERNAL_STATUS = 500;

/** The RFC 9457 members, plus `code`: Tenbox's short machine-readable slug. */
interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
}

function problem(c: Context, status: ContentfulStatusCode, code: string, detail: string): Response {
  const title = STATUS_CODES[status] ?? "Error";
  const body: Problem = { type: BLANK_TYPE, title, status, detail, code };
  return c.body(JSON.stringify(body), status, { "Content-Type": PROBLEM_CONTENT_TYPE });
}

/** `app.onError`: a known error keeps its message; any other is a 500 that hides it. */
export function onError(error: Error, c: Context): Response {
  if (error instanceof TenboxError && error.code === "unauthorized") {
    return problem(c, UNAUTHORIZED_STATUS, error.code, error.message);
  }
  // Until TEN-362 brings a logger, the hidden error goes to stderr as it is.
  console.error(error);
  const code = error instanceof TenboxError ? error.code : "internal";
  return problem(c, INTERNAL_STATUS, code, "the server failed; see its log");
}

export function notFound(c: Context): Response {
  const detail = `no route for ${c.req.method} ${c.req.path}`;
  return problem(c, NOT_FOUND_STATUS, "not-found", detail);
}
