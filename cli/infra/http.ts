import type { z } from "zod";
import { TenboxError } from "../../domain/errors/index.ts";
import { errorMessage } from "../../domain/utils.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_CHARS = 200;

/** One external service; its name and error code mark every failure that comes from it. */
export interface Endpoint {
  service: string;
  url: string;
  headers: Record<string, string>;
  errorCode: string;
}

export interface JsonRequest<T> {
  endpoint: Endpoint;
  body: unknown;
  schema: z.ZodType<T>;
}

/** POST a JSON body and validate the JSON answer; every failure is a `TenboxError`. */
export async function postJson<T>(request: JsonRequest<T>): Promise<T> {
  const { endpoint } = request;
  const response = await send(endpoint, request.body);
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
  return new TenboxError(`${endpoint.service}: ${message}`, endpoint.errorCode);
}

/** A network error or no answer in time is the service's failure, not an internal one. */
async function send(endpoint: Endpoint, body: unknown): Promise<Response> {
  try {
    return await fetch(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...endpoint.headers },
      body: JSON.stringify(body),
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
