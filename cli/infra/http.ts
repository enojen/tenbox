import type { z } from "zod";
import type { TenboxError } from "../../domain/errors/index.ts";
import { errorMessage } from "../../domain/errors/index.ts";
import { serviceError } from "../../domain/errors/tools.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_CHARS = 200;
const HTTP_CONFLICT = 409;

/** PEM text: the server's CA, and the client certificate and key when they replace a token. */
export interface EndpointTls {
  ca?: string;
  cert?: string;
  key?: string;
}

/** One external service; its name and error code mark every failure that comes from it. */
export interface Endpoint {
  service: string;
  url: string;
  headers: Record<string, string>;
  errorCode: string;
  tls?: EndpointTls;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** A request without a body; the answer must match `schema`. */
interface JsonGet<T> {
  endpoint: Endpoint;
  schema: z.ZodType<T>;
}

/** A request with a JSON body. */
interface JsonRequest<T> extends JsonGet<T> {
  body: unknown;
}

/** What `fetch` sends besides the endpoint: the method and the body, if any. */
interface HttpCall {
  method: HttpMethod;
  body?: string;
}

/** JSON over HTTP: every answer is validated with its schema; every failure is a `TenboxError`. */
export const http = { get, post, put, remove, ensure };

/** GET, no body. */
function get<T>(request: JsonGet<T>): Promise<T> {
  return sendJson(request, { method: "GET" });
}

/** POST a JSON body. */
function post<T>(request: JsonRequest<T>): Promise<T> {
  return sendJson(request, { method: "POST", body: JSON.stringify(request.body) });
}

/** PUT a JSON body. */
function put<T>(request: JsonRequest<T>): Promise<T> {
  return sendJson(request, { method: "PUT", body: JSON.stringify(request.body) });
}

/** DELETE, no body; the answer is not read. */
async function remove(endpoint: Endpoint): Promise<void> {
  const response = await send(endpoint, { method: "DELETE" });
  if (response.ok) return;
  const text = await response.text();
  throw endpointError(endpoint, `HTTP ${response.status}: ${text.slice(0, ERROR_BODY_CHARS)}`);
}

/** POST a JSON body; null when the server answers 409 Conflict: the object exists already. */
async function ensure<T>(request: JsonRequest<T>): Promise<T | null> {
  const call: HttpCall = { method: "POST", body: JSON.stringify(request.body) };
  const response = await send(request.endpoint, call);
  if (response.status === HTTP_CONFLICT) return null;
  return readAnswer(request, response);
}

async function sendJson<T>(request: JsonGet<T>, call: HttpCall): Promise<T> {
  const response = await send(request.endpoint, call);
  return readAnswer(request, response);
}

async function readAnswer<T>(request: JsonGet<T>, response: Response): Promise<T> {
  const { endpoint } = request;
  if (!response.ok) {
    const text = await response.text();
    const detail = text.slice(0, ERROR_BODY_CHARS);
    throw endpointError(endpoint, `HTTP ${response.status}: ${detail}`);
  }
  const json = await readJson(endpoint, response);
  const parsed = request.schema.safeParse(json);
  if (!parsed.success) throw endpointError(endpoint, "unexpected response");
  return parsed.data;
}

export function endpointError(endpoint: Endpoint, message: string): TenboxError {
  return serviceError(endpoint.service, endpoint.errorCode, message);
}

/** A network error or no answer in time is the service's failure, not an internal one. */
async function send(endpoint: Endpoint, call: HttpCall): Promise<Response> {
  try {
    return await fetch(endpoint.url, {
      ...call,
      headers: { "Content-Type": "application/json", ...endpoint.headers },
      ...(endpoint.tls === undefined ? {} : { tls: endpoint.tls }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw endpointError(endpoint, errorMessage(e));
  }
}

async function readJson(endpoint: Endpoint, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw endpointError(endpoint, "the answer is not JSON");
  }
}
