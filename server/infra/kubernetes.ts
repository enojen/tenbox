import path from "node:path";
import { z } from "zod";
import { serviceError } from "../../domain/errors/tools.ts";
import type { BoxEnd, ListedPod } from "../../domain/events.ts";
import { http } from "./http.ts";

/** Where Kubernetes mounts the pod's service account token and the cluster CA. */
const SERVICE_ACCOUNT_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const NODES_PATH = "/api/v1/nodes";
/** The pods of the task Jobs, the machine runs. */
const PODS_PATH = "/api/v1/namespaces/tenbox/pods";
const JOB_POD_SELECTOR = "app=tenyard";
const BOX = "box";
/** The pod condition set when the scheduler placed the pod on a node. */
const POD_SCHEDULED = { type: "PodScheduled", status: "True" } as const;
const SERVICE = "kubernetes";
const LOG_TIMEOUT_MS = 30_000;
const ERROR_BODY_CHARS = 200;

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

type Pod = z.infer<typeof PodSchema>;
type Container = z.infer<typeof ContainerSchema>;
type ContainerStatus = z.infer<typeof ContainerStatusSchema>;

/** One pod's log, by name. */
interface PodLog {
  api: KubernetesApi;
  pod: string;
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

/** The pods of the task Jobs in one request; a pod without a `task` label is left out. */
async function jobPods(api: KubernetesApi): Promise<ListedPod[]> {
  const { token, ca } = await credentials(api);
  const selector = encodeURIComponent(JOB_POD_SELECTOR);
  const list = await http.get({
    service: SERVICE,
    url: `${api.url}${PODS_PATH}?labelSelector=${selector}`,
    token,
    schema: PodListSchema,
    ca,
  });
  return list.items.flatMap(listedPod);
}

/** The last line of the box container's log: the boot line with `oom_kill <n>`. */
async function lastLogLine(input: PodLog): Promise<string> {
  const { api, pod } = input;
  const { token, ca } = await credentials(api);
  const url = `${api.url}${PODS_PATH}/${encodeURIComponent(pod)}/log?container=${BOX}&tailLines=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(LOG_TIMEOUT_MS),
    tls: { ca },
  });
  const text = await response.text();
  if (response.ok) return text;
  throw serviceError(
    SERVICE,
    SERVICE,
    `HTTP ${response.status}: ${text.slice(0, ERROR_BODY_CHARS)}`,
  );
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

export const kubernetes = { inCluster, nodes, jobPods, lastLogLine };
