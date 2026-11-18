import { z } from "zod";
import { errorMessage, TenboxError } from "../../domain/errors/index.ts";
import { serviceError } from "../../domain/errors/tools.ts";
import { jsons } from "../../domain/utils.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_CHARS = 200;
const HTTP_CONFLICT = 409;
const HTTP_NOT_FOUND = 404;

/** One external service; its name and error code mark every failure that comes from it. */
export interface Endpoint {
  service: string;
  url: string;
  headers: Record<string, string>;
  errorCode: string;
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
  /** No timeout, for a stream. */
  unlimited?: boolean;
}

/** JSON over HTTP: every answer is validated with its schema; every failure is a `TenboxError`. */
export const http = { get, post, put, ensure, remove, stream };

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

/** POST a JSON body; null when the server answers 409 Conflict: the object exists already. */
async function ensure<T>(request: JsonRequest<T>): Promise<T | null> {
  const call: HttpCall = { method: "POST", body: JSON.stringify(request.body) };
  const response = await send(request.endpoint, call);
  if (response.status === HTTP_CONFLICT) return null;
  return readAnswer(request, response);
}

/** A GET whose answer body is read as text; `unlimited` drops the timeout. */
interface TextStream {
  endpoint: Endpoint;
  unlimited: boolean;
}

/** GET the answer body as a text stream; a followed log is `unlimited`, it runs as long as it runs. */
async function stream(request: TextStream): Promise<AsyncIterable<string>> {
  const { endpoint, unlimited } = request;
  const response = await send(endpoint, { method: "GET", unlimited });
  if (!response.ok) {
    const failure = await httpFailure(endpoint, response);
    throw failure;
  }
  return response.body === null
    ? emptyStream()
    : response.body.pipeThrough(new TextDecoderStream());
}

/** DELETE; false when the server answers 404 Not Found: the object is gone already. */
async function remove(endpoint: Endpoint): Promise<boolean> {
  const response = await send(endpoint, { method: "DELETE" });
  if (response.status === HTTP_NOT_FOUND) return false;
  if (response.ok) return true;
  const failure = await httpFailure(endpoint, response);
  throw failure;
}

async function sendJson<T>(request: JsonGet<T>, call: HttpCall): Promise<T> {
  const response = await send(request.endpoint, call);
  return readAnswer(request, response);
}

async function readAnswer<T>(request: JsonGet<T>, response: Response): Promise<T> {
  const { endpoint } = request;
  if (!response.ok) {
    const failure = await httpFailure(endpoint, response);
    throw failure;
  }
  const json = await readJson(endpoint, response);
  const parsed = request.schema.safeParse(json);
  if (!parsed.success) throw endpointError(endpoint, "unexpected response");
  return parsed.data;
}

async function httpFailure(endpoint: Endpoint, response: Response): Promise<TenboxError> {
  const text = await response.text();
  const failure: HttpFailure = {
    status: response.status,
    ...problemOf(text),
    ...retryAfterOf(response),
  };
  return endpointError(
    endpoint,
    `HTTP ${response.status}: ${text.slice(0, ERROR_BODY_CHARS)}`,
    failure,
  );
}

/** A failed answer: its status, the `code` and `detail` of a problem body, and `Retry-After`. */
const HttpFailureSchema = z.object({
  status: z.number(),
  code: z.string().optional(),
  detail: z.string().optional(),
  retryAfterSeconds: z.number().optional(),
});
export type HttpFailure = z.infer<typeof HttpFailureSchema>;

const ProblemSchema = z.object({ code: z.string(), detail: z.string() });
type Problem = z.infer<typeof ProblemSchema>;

type NoFields = Record<string, never>;

function problemOf(text: string): Problem | NoFields {
  const checked = jsons.check(ProblemSchema, text);
  return checked.ok ? checked.value : {};
}

interface RetryAfter {
  retryAfterSeconds: number;
}

function retryAfterOf(response: Response): RetryAfter | NoFields {
  const seconds = Number(response.headers.get("retry-after") ?? "");
  return Number.isInteger(seconds) && seconds > 0 ? { retryAfterSeconds: seconds } : {};
}

export function endpointError(
  endpoint: Endpoint,
  message: string,
  details?: HttpFailure,
): TenboxError {
  return serviceError(endpoint.service, endpoint.errorCode, message, details);
}

/** The failed answer of an HTTP error; null for a network error or any other error. */
export function failedAnswer(error: unknown): HttpFailure | null {
  if (!(error instanceof TenboxError)) return null;
  const parsed = HttpFailureSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/** The HTTP status of a failed answer; null for a network error or any other error. */
export function failedStatus(error: unknown): number | null {
  return failedAnswer(error)?.status ?? null;
}

/** A network error or no answer in time is the service's failure, not an internal one. */
async function send(endpoint: Endpoint, call: HttpCall): Promise<Response> {
  try {
    const { unlimited, ...init } = call;
    return await fetch(endpoint.url, {
      ...init,
      headers: { "Content-Type": "application/json", ...endpoint.headers },
      ...(unlimited === true ? {} : { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    });
  } catch (e) {
    throw serviceError(endpoint.service, endpoint.errorCode, errorMessage(e), UNREACHED);
  }
}

/** The details of a request that got no answer: a network error or no answer in time. */
const UNREACHED = { unreached: true };
const UnreachedSchema = z.object({ unreached: z.literal(true) });

/** The request got no answer at all; a failed answer is not this. */
export function wasUnreached(error: unknown): boolean {
  return error instanceof TenboxError && UnreachedSchema.safeParse(error.details).success;
}

async function readJson(endpoint: Endpoint, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw endpointError(endpoint, "the answer is not JSON");
  }
}

async function* emptyStream(): AsyncGenerator<string> {}
