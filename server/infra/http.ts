import type { z } from "zod";
import { errorMessage, type TenboxError } from "../../domain/errors/index.ts";
import { serviceError } from "../../domain/errors/tools.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_CHARS = 200;
const HTTP_NOT_FOUND = 404;

/** An HTTP error answer of an outside API: the service that sent it, its status and its body as text. */
interface HttpFailure {
  service: string;
  status: number;
  text: string;
}

/** One JSON GET of an outside API with a bearer token; `service` names it in every error. */
interface JsonGet<T> {
  service: string;
  url: string;
  token: string;
  schema: z.ZodType<T>;
  /** The CA in PEM, for a server whose certificate no public CA signs. */
  ca?: string;
}

interface JsonPost<T> extends JsonGet<T> {
  body: unknown;
}

/** A failure to reach the API, an HTTP error or an answer off the schema is the service's error, with its name as the code. */
async function get<T>(request: JsonGet<T>): Promise<T> {
  const response = await send(request, undefined);
  return answer(request, response);
}

async function find<T>(request: JsonGet<T>): Promise<T | null> {
  const response = await send(request, undefined);
  if (response.status === HTTP_NOT_FOUND) return null;
  return answer(request, response);
}

async function post<T>(request: JsonPost<T>): Promise<T> {
  const response = await send(request, request.body);
  return answer(request, response);
}

async function answer<T>(request: JsonGet<T>, response: Response): Promise<T> {
  const { service, url, schema } = request;
  if (!response.ok) {
    const text = await response.text();
    throw failed({ service, status: response.status, text });
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

async function send<T>(request: JsonGet<T>, body: unknown): Promise<Response> {
  const { service, url, token, ca } = request;
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: timeout(),
      ...(ca === undefined ? {} : { tls: { ca } }),
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw serviceError(service, service, errorMessage(error));
  }
}

/** The service's error for an HTTP error answer, with its name as the code and the start of the body. */
function failed(failure: HttpFailure): TenboxError {
  const { service, status, text } = failure;
  return serviceError(service, service, `HTTP ${status}: ${text.slice(0, ERROR_BODY_CHARS)}`);
}

/** The abort signal of one request to an outside API. */
function timeout(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

/** HTTP for the server's outside APIs: a JSON GET or POST validated with its schema, and the timeout and error every request shares. */
export const http = { get, find, post, failed, timeout };
