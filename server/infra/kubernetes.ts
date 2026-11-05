import path from "node:path";
import { z } from "zod";
import { errorMessage } from "../../domain/errors/index.ts";
import { serviceError } from "../../domain/errors/tools.ts";

/** Where Kubernetes mounts the pod's service account token and the cluster CA. */
const SERVICE_ACCOUNT_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const NODES_PATH = "/api/v1/nodes";
const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_CHARS = 200;

/** The cluster API and the files of the service account; the token is read at each request, as the kubelet rotates it. */
export interface KubernetesApi {
  url: string;
  tokenFile: string;
  caFile: string;
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

const NodeSchema = z.object({
  metadata: z.object({ name: z.string().min(1) }),
  spec: z.object({ providerID: z.string().optional() }).default({}),
});

const NodeListSchema = z.object({ items: z.array(NodeSchema) });

/** A Node by name, with its `spec.providerID` (`hcloud://<id>` on Hetzner); null before the cloud controller sets it. */
export interface ClusterNode {
  name: string;
  providerId: string | null;
}

/** The API of the cluster the server runs in, as its pod sees it. */
function inCluster(url: string): KubernetesApi {
  return {
    url,
    tokenFile: path.join(SERVICE_ACCOUNT_DIR, "token"),
    caFile: path.join(SERVICE_ACCOUNT_DIR, "ca.crt"),
  };
}

/** Every Node of the cluster. */
async function nodes(api: KubernetesApi): Promise<ClusterNode[]> {
  const token = await Bun.file(api.tokenFile).text();
  const ca = await Bun.file(api.caFile).text();
  const list = await getJson({
    service: "kubernetes",
    url: `${api.url}${NODES_PATH}`,
    token: token.trim(),
    schema: NodeListSchema,
    ca,
  });
  return list.items.map((item) => ({
    name: item.metadata.name,
    providerId: item.spec.providerID ?? null,
  }));
}

/** A failure to reach the API, an HTTP error or an answer off the schema is the service's error, with its name as the code. */
export async function getJson<T>(request: JsonGet<T>): Promise<T> {
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

export const kubernetes = { inCluster, nodes };
