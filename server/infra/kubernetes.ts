import path from "node:path";
import { z } from "zod";
import type { TenboxError } from "../../domain/errors/index.ts";
import type { BoxEnd, ListedPod, ListedVolume } from "../../domain/events.ts";
import { http } from "./http.ts";

/** Where Kubernetes mounts the pod's service account token and the cluster CA. */
const SERVICE_ACCOUNT_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const NODES_PATH = "/api/v1/nodes";
/** The pods of the task Jobs, the machine runs. */
const PODS_PATH = "/api/v1/namespaces/tenbox/pods";
/** The task volumes, one PVC per task. */
const PVCS_PATH = "/api/v1/namespaces/tenbox/persistentvolumeclaims";
/** The label of the pods and the PVCs of the task Jobs. */
const TASK_SELECTOR = "app=tenyard";
/** The PVC phase once its volume exists. */
const BOUND = "Bound";
const BOX = "box";
/** The pod condition set when the scheduler placed the pod on a node. */
const POD_SCHEDULED = { type: "PodScheduled", status: "True" } as const;
const SERVICE = "kubernetes";
const HTTP_NOT_FOUND = 404;

/** The cluster API and the files of the service account; the token is read at each request, as the kubelet rotates it. */
export interface KubernetesApi {
  url: string;
  tokenFile: string;
  caFile: string;
}

/** The token and CA of one request. */
interface Credentials {
  token: string;
  ca: string;
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

const EnvVarSchema = z.object({ name: z.string(), value: z.string().optional() });

const ContainerSchema = z.object({
  name: z.string(),
  env: z.array(EnvVarSchema).default([]),
  resources: z
    .object({
      requests: z.object({ cpu: z.string().optional(), memory: z.string().optional() }).default({}),
    })
    .default({ requests: {} }),
});

const TerminatedSchema = z.object({
  exitCode: z.number().int(),
  reason: z.string().optional(),
  startedAt: z.iso.datetime().nullish(),
  finishedAt: z.iso.datetime().nullish(),
});

const ContainerStatusSchema = z.object({
  name: z.string(),
  state: z
    .object({
      running: z.object({ startedAt: z.iso.datetime().nullish() }).optional(),
      terminated: TerminatedSchema.optional(),
    })
    .default({}),
});

const PodSchema = z.object({
  metadata: z.object({
    name: z.string().min(1),
    uid: z.string().min(1),
    creationTimestamp: z.iso.datetime(),
    labels: z.record(z.string(), z.string()).default({}),
  }),
  spec: z.object({ nodeName: z.string().optional(), containers: z.array(ContainerSchema) }),
  status: z
    .object({
      conditions: z
        .array(
          z.object({
            type: z.string(),
            status: z.string(),
            lastTransitionTime: z.iso.datetime().nullish(),
          }),
        )
        .default([]),
      containerStatuses: z.array(ContainerStatusSchema).default([]),
    })
    .default({ conditions: [], containerStatuses: [] }),
});

const PodListSchema = z.object({ items: z.array(PodSchema) });

const PvcSchema = z.object({
  metadata: z.object({
    name: z.string().min(1),
    uid: z.string().min(1),
    creationTimestamp: z.iso.datetime(),
    labels: z.record(z.string(), z.string()).default({}),
  }),
  status: z
    .object({
      phase: z.string().optional(),
      capacity: z.object({ storage: z.string().optional() }).default({}),
    })
    .default({ capacity: {} }),
});

const PvcListSchema = z.object({ items: z.array(PvcSchema) });

type Pod = z.infer<typeof PodSchema>;
type Pvc = z.infer<typeof PvcSchema>;
type Container = z.infer<typeof ContainerSchema>;
type ContainerStatus = z.infer<typeof ContainerStatusSchema>;

/** One pod's log, by name. */
interface PodLog {
  api: KubernetesApi;
  pod: string;
}

/** One task PVC, by name. */
interface VolumeName {
  api: KubernetesApi;
  name: string;
}

/** The API of the cluster the server runs in, as its pod sees it. */
function inCluster(url: string): KubernetesApi {
  return {
    url,
    tokenFile: path.join(SERVICE_ACCOUNT_DIR, "token"),
    caFile: path.join(SERVICE_ACCOUNT_DIR, "ca.crt"),
  };
}

async function credentials(api: KubernetesApi): Promise<Credentials> {
  const token = await Bun.file(api.tokenFile).text();
  const ca = await Bun.file(api.caFile).text();
  return { token: token.trim(), ca };
}

/** Every Node of the cluster. */
async function nodes(api: KubernetesApi): Promise<ClusterNode[]> {
  const { token, ca } = await credentials(api);
  const list = await http.get({
    service: SERVICE,
    url: `${api.url}${NODES_PATH}`,
    token,
    schema: NodeListSchema,
    ca,
  });
  return list.items.map((item) => ({
    name: item.metadata.name,
    providerId: item.spec.providerID ?? null,
  }));
}

/** The items of one list of the task Jobs' objects, in one request. */
interface TaskList<T> {
  api: KubernetesApi;
  path: string;
  schema: z.ZodType<{ items: T[] }>;
}

async function taskItems<T>(list: TaskList<T>): Promise<T[]> {
  const { api, path: listPath, schema } = list;
  const { token, ca } = await credentials(api);
  const selector = encodeURIComponent(TASK_SELECTOR);
  const answer = await http.get({
    service: SERVICE,
    url: `${api.url}${listPath}?labelSelector=${selector}`,
    token,
    schema,
    ca,
  });
  return answer.items;
}

/** The pods of the task Jobs in one request; a pod without a `task` label is left out. */
async function jobPods(api: KubernetesApi): Promise<ListedPod[]> {
  const items = await taskItems({ api, path: PODS_PATH, schema: PodListSchema });
  return items.flatMap(listedPod);
}

/** The Bound task PVCs in one request; a PVC without a `task` label or a capacity is left out. */
async function taskVolumes(api: KubernetesApi): Promise<ListedVolume[]> {
  const items = await taskItems({ api, path: PVCS_PATH, schema: PvcListSchema });
  return items.flatMap(listedVolume);
}

function listedVolume(pvc: Pvc): ListedVolume[] {
  const { metadata, status } = pvc;
  const task = metadata.labels.task;
  const capacity = status.capacity.storage;
  if (task === undefined || capacity === undefined || status.phase !== BOUND) return [];
  const created = isoTime(metadata.creationTimestamp);
  return [{ name: metadata.name, uid: metadata.uid, task, created, capacity }];
}

/** The last line of the box container's log: the boot line with `oom_kill <n>`. */
function lastLogLine(input: PodLog): Promise<string> {
  return readLog(input, "&tailLines=1");
}

/** The whole log of the box container. */
function boxLog(input: PodLog): Promise<string> {
  return readLog(input, "");
}

async function readLog(input: PodLog, query: string): Promise<string> {
  const { api, pod } = input;
  const apiPath = `${PODS_PATH}/${encodeURIComponent(pod)}/log?container=${BOX}${query}`;
  const answer = await send({ api, apiPath, method: "GET" });
  if (answer.ok) return answer.text;
  throw failed(answer);
}

/** Deletes one task PVC; an answer 404 means it is gone already. */
async function removeVolume(input: VolumeName): Promise<void> {
  const { api, name } = input;
  const apiPath = `${PVCS_PATH}/${encodeURIComponent(name)}`;
  const answer = await send({ api, apiPath, method: "DELETE" });
  if (answer.ok || answer.status === HTTP_NOT_FOUND) return;
  throw failed(answer);
}

type ClusterMethod = "GET" | "DELETE";

/** One request whose answer is not a JSON list: a log or a DELETE. */
interface ClusterRequest {
  api: KubernetesApi;
  /** The API path, with its query. */
  apiPath: string;
  method: ClusterMethod;
}

/** The status of an answer and its body as text. */
interface ClusterAnswer {
  ok: boolean;
  status: number;
  text: string;
}

async function send(request: ClusterRequest): Promise<ClusterAnswer> {
  const { api, apiPath, method } = request;
  const { token, ca } = await credentials(api);
  const response = await fetch(`${api.url}${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: http.timeout(),
    tls: { ca },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

function failed(answer: ClusterAnswer): TenboxError {
  return http.failed({ service: SERVICE, status: answer.status, text: answer.text });
}

function listedPod(pod: Pod): ListedPod[] {
  const { metadata, spec, status } = pod;
  const task = metadata.labels.task;
  if (task === undefined) return [];
  const box = spec.containers.find((container) => container.name === BOX);
  const boxStatus = status.containerStatuses.find((container) => container.name === BOX);
  const scheduled = status.conditions.find(
    (condition) =>
      condition.type === POD_SCHEDULED.type && condition.status === POD_SCHEDULED.status,
  );
  return [
    {
      uid: metadata.uid,
      name: metadata.name,
      job: metadata.labels["job-name"] ?? null,
      task,
      project: envValue(box, "TENBOX_PROJECT"),
      command: envValue(box, "TENBOX_CMD"),
      class: metadata.labels.class ?? null,
      node: spec.nodeName ?? null,
      created: isoTime(metadata.creationTimestamp),
      scheduled: optionalIsoTime(scheduled?.lastTransitionTime),
      started: optionalIsoTime(
        boxStatus?.state.running?.startedAt ?? boxStatus?.state.terminated?.startedAt,
      ),
      end: boxEnd(boxStatus),
      requests: {
        cpu: box?.resources.requests.cpu ?? null,
        memory: box?.resources.requests.memory ?? null,
      },
    },
  ];
}

function envValue(container: Container | undefined, name: string): string | null {
  return container?.env.find((variable) => variable.name === name)?.value ?? null;
}

/** Null while the box runs, and for a terminated state without a finish time. */
function boxEnd(status: ContainerStatus | undefined): BoxEnd | null {
  const terminated = status?.state.terminated;
  const finished = optionalIsoTime(terminated?.finishedAt);
  if (terminated === undefined || finished === null) return null;
  return { exitCode: terminated.exitCode, reason: terminated.reason ?? null, finished };
}

/** UTC with milliseconds, as Tenbox writes times, so stored times sort as text. */
function isoTime(text: string): string {
  return new Date(text).toISOString();
}

function optionalIsoTime(text: string | null | undefined): string | null {
  return text === null || text === undefined ? null : isoTime(text);
}

export const kubernetes = {
  inCluster,
  nodes,
  jobPods,
  taskVolumes,
  lastLogLine,
  boxLog,
  removeVolume,
};
