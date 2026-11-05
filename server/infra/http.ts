import type { z } from "zod";
import { errorMessage } from "../../domain/errors/index.ts";
import { serviceError } from "../../domain/errors/tools.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_CHARS = 200;

/** One JSON GET of an outside API with a bearer token; `service` names it in every error. */
interface JsonGet<T> {
  service: string;
  url: string;
  token: string;
  schema: z.ZodType<T>;
  /** The CA in PEM, for a server whose certificate no public CA signs. */
  ca?: string;
}

/** A failure to reach the API, an HTTP error or an answer off the schema is the service's error, with its name as the code. */
async function get<T>(request: JsonGet<T>): Promise<T> {
  const { service, url, schema } = request;
  const response = await send(request);
  if (!response.ok) {
    const text = await response.text();
    const detail = text.slice(0, ERROR_BODY_CHARS);
    throw serviceError(service, service, `HTTP ${response.status}: ${detail}`);
  }
  const answer = await readJson(request, response);
  const parsed = schema.safeParse(answer);
  if (!parsed.success) throw serviceError(service, service, `unexpected answer from ${url}`);
  return parsed.data;
}

async function readJson<T>(request: JsonGet<T>, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw serviceError(
      request.service,
      request.service,
      `the answer of ${request.url} is not JSON`,
    );
  }
}

async function send<T>(request: JsonGet<T>): Promise<Response> {
  const { service, url, token, ca } = request;
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(ca === undefined ? {} : { tls: { ca } }),
    });
  } catch (error) {
    throw serviceError(service, service, errorMessage(error));
  }
}

/** JSON over HTTP for the server's outside APIs: every answer is validated with its schema. */
export const http = { get };
