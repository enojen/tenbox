import { z } from "zod";
import { issueLines } from "../../domain/errors/index.ts";
import { kubeconfigError, noKubeconfigError, templateError } from "../../domain/errors/tools.ts";
import { objects } from "../../domain/utils.ts";
import { files } from "./files.ts";
import { type Endpoint, type EndpointTls, http } from "./http.ts";

/** The namespace of the task Jobs and volumes on the cluster. */
const NAMESPACE = "tenbox";
const JOBS_PATH = `/apis/batch/v1/namespaces/${NAMESPACE}/jobs`;
const VOLUMES_PATH = `/api/v1/namespaces/${NAMESPACE}/persistentvolumeclaims`;
const SECRETS_PATH = `/api/v1/namespaces/${NAMESPACE}/secrets`;

/** The API server of the kubeconfig's current context and how to log in to it. */
export interface Cluster {
  server: string;
  /** `Authorization` when the user has a token. */
  headers: Record<string, string>;
  /** The CA, and the client certificate and key when the user has no token. */
  tls: EndpointTls;
}

/** The values of the `__X__` fields of the tenyard templates, as tenyard `task/run.sh` fills them. */
export interface TemplateFields {
  /** The task id in lower case, `_` as `-`: a Kubernetes name. */
  name: string;
  task: string;
  /** The run stamp `MMDD-HHMMSS`. */
  run: string;
  project: string;
  projectId: string;
  repo: string;
  image: string;
  cmd: string;
  /** `machine.env` of the manifest as one JSON object. */
  env: string;
  /** The resource class and its values from tenyard `task/classes.yaml`. */
  class: string;
  cpu: string;
  cpuLimit: string;
  memory: string;
}

/** One class of tenyard `task/classes.yaml`; its RAM is both the request and the limit. */
const ResourceClassSchema = z
  .object({ cpu: z.string().min(1), cpu_limit: z.string().min(1), memory: z.string().min(1) })
  .strict();

const ClassesSchema = z.record(z.string(), ResourceClassSchema);

type ClassResources = z.infer<typeof ResourceClassSchema>;

/** One class of a classes file, by name. */
interface ClassInput {
  file: string;
  name: string;
}

const BOX = "box";

const NamedSchema = z.looseObject({ name: z.string().min(1) });

type Named = z.infer<typeof NamedSchema>;

/** A strategic merge patch of the Job; tenbox adds only these keys, so it refuses any other. */
const ServiceSchema = z
  .object({
    spec: z
      .object({
        template: z
          .object({
            spec: z
              .object({
                initContainers: z.array(NamedSchema).default([]),
                containers: z
                  .array(
                    z
                      .object({
                        name: z.literal(BOX),
                        env: z.array(
                          z.object({ name: z.string().min(1), value: z.string() }).strict(),
                        ),
                      })
                      .strict(),
                  )
                  .default([]),
                volumes: z.array(NamedSchema).default([]),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

/** `env` goes to `TENBOX_ENV`: the box gives its command no other variable of the container. */
export interface Service {
  sidecars: Named[];
  volumes: Named[];
  env: Record<string, string>;
}

const JobPodSchema = z.looseObject({
  spec: z.looseObject({
    template: z.looseObject({
      spec: z.looseObject({
        initContainers: z.array(NamedSchema).default([]),
        volumes: z.array(NamedSchema).default([]),
      }),
    }),
  }),
});

interface ServicesInput {
  file: string;
  job: KubeObject;
  services: Service[];
}

/** One template file and the values for its fields. */
interface TemplateInput {
  file: string;
  fields: TemplateFields;
}

/** One Job of the namespace, as far as `tenbox machine` reads it. */
export interface Job {
  name: string;
  /** `TENBOX_CMD` of its first container; empty without one. */
  cmd: string;
  active: number;
  succeeded: number;
  failed: number;
  created: string;
  url: string;
}

/** A Kubernetes object to create: the filled template. */
type KubeObject = Record<string, unknown>;

interface ObjectPost {
  cluster: Cluster;
  object: KubeObject;
}

/** An Opaque Secret of the namespace and its values by key. */
interface SecretInput {
  cluster: Cluster;
  name: string;
  values: Record<string, string>;
}

/** The task Jobs, volumes and Secrets on the cluster, over its HTTP API. */
export const kubernetes = {
  readCluster,
  readTemplate,
  readClass,
  readService,
  addServices,
  listJobs,
  ensureVolume,
  saveSecret,
  createJob,
};

const KubeconfigSchema = z.object({
  "current-context": z.string().optional(),
  contexts: z
    .array(
      z.object({ name: z.string(), context: z.object({ cluster: z.string(), user: z.string() }) }),
    )
    .default([]),
  clusters: z
    .array(
      z.object({
        name: z.string(),
        cluster: z.object({
          server: z.string(),
          "certificate-authority-data": z.string().optional(),
        }),
      }),
    )
    .default([]),
  users: z
    .array(
      z.object({
        name: z.string(),
        user: z.object({
          token: z.string().optional(),
          "client-certificate-data": z.string().optional(),
          "client-key-data": z.string().optional(),
        }),
      }),
    )
    .default([]),
});

type Kubeconfig = z.infer<typeof KubeconfigSchema>;
type KubeUser = Kubeconfig["users"][number]["user"];

/** The current context of the kubeconfig at `file`; no error names a credential. */
async function readCluster(file: string): Promise<Cluster> {
  const text = await files.read(file);
  if (text === null) throw noKubeconfigError(file);
  const parsed = KubeconfigSchema.safeParse(parseYaml(text));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "top");
    throw kubeconfigError(file, `unexpected ${fields.join(", ")}`);
  }
  return currentCluster(file, parsed.data);
}

/** A YAML error message may quote the line, and the line may hold a key. */
function parseYaml(text: string): unknown {
  try {
    return Bun.YAML.parse(text);
  } catch {
    return null;
  }
}

function currentCluster(file: string, config: Kubeconfig): Cluster {
  const contextName = config["current-context"];
  const context = config.contexts.find((c) => c.name === contextName)?.context;
  if (context === undefined) throw kubeconfigError(file, `no context "${contextName ?? ""}"`);
  const cluster = config.clusters.find((c) => c.name === context.cluster)?.cluster;
  if (cluster === undefined) throw kubeconfigError(file, `no cluster "${context.cluster}"`);
  const user = config.users.find((u) => u.name === context.user)?.user;
  if (user === undefined) throw kubeconfigError(file, `no user "${context.user}"`);
  const caData = cluster["certificate-authority-data"];
  const ca = caData === undefined ? {} : { ca: fromBase64(caData) };
  const server = cluster.server.replace(/\/+$/, "");
  if (user.token !== undefined) {
    return { server, headers: { Authorization: `Bearer ${user.token}` }, tls: ca };
  }
  return { server, headers: {}, tls: { ...ca, ...clientCertificate(file, user) } };
}

function clientCertificate(file: string, user: KubeUser): EndpointTls {
  const cert = user["client-certificate-data"];
  const key = user["client-key-data"];
  if (cert === undefined || key === undefined) {
    throw kubeconfigError(file, "the user has no token and no client certificate and key");
  }
  return { cert: fromBase64(cert), key: fromBase64(key) };
}

const fromBase64 = (data: string): string => Buffer.from(data, "base64").toString("utf8");

/** Reads one tenyard template and fills its `__X__` fields in every string value. */
async function readTemplate(input: TemplateInput): Promise<KubeObject> {
  const { file, fields } = input;
  const text = await files.read(file);
  if (text === null) throw templateError(file, "missing");
  const value = parseYaml(text);
  if (!objects.isRecord(value)) throw templateError(file, "not a YAML mapping");
  return fillObject(value, placeholders(fields));
}

async function readClass(input: ClassInput): Promise<ClassResources> {
  const { file, name } = input;
  const text = await files.read(file);
  if (text === null) throw templateError(file, "missing");
  const parsed = ClassesSchema.safeParse(parseYaml(text));
  if (!parsed.success) throw templateError(file, issueLines(parsed.error).join("; "));
  const found = parsed.data[name];
  if (found === undefined) {
    throw templateError(file, `no class "${name}" (${Object.keys(parsed.data).join(", ")})`);
  }
  return found;
}

async function readService(file: string): Promise<Service> {
  const text = await files.read(file);
  if (text === null) throw templateError(file, "missing");
  const parsed = ServiceSchema.safeParse(parseYaml(text));
  if (!parsed.success) throw templateError(file, issueLines(parsed.error).join("; "));
  const pod = parsed.data.spec.template.spec;
  return {
    sidecars: pod.initContainers,
    volumes: pod.volumes,
    env: Object.fromEntries(pod.containers.flatMap((c) => c.env).map((e) => [e.name, e.value])),
  };
}

/** As `kubectl patch --type strategic`: an entry replaces the one of its name. */
function addServices(input: ServicesInput): KubeObject {
  const { file, job, services } = input;
  if (services.length === 0) return job;
  const parsed = JobPodSchema.safeParse(job);
  if (!parsed.success) throw templateError(file, issueLines(parsed.error).join("; "));
  const pod = parsed.data.spec.template.spec;
  for (const service of services) {
    pod.initContainers = byName(pod.initContainers, service.sidecars);
    pod.volumes = byName(pod.volumes, service.volumes);
  }
  return parsed.data;
}

function byName(base: Named[], added: Named[]): Named[] {
  const names = new Set(added.map((entry) => entry.name));
  return [...base.filter((entry) => !names.has(entry.name)), ...added];
}

type Placeholders = [string, string][];

function placeholders(fields: TemplateFields): Placeholders {
  return [
    ["__NAME__", fields.name],
    ["__TASK__", fields.task],
    ["__RUN__", fields.run],
    ["__PROJECT__", fields.project],
    ["__PROJECT_ID__", fields.projectId],
    ["__REPO__", fields.repo],
    ["__IMAGE__", fields.image],
    ["__CMD__", fields.cmd],
    ["__ENV__", fields.env],
    ["__CLASS__", fields.class],
    ["__CPU__", fields.cpu],
    ["__CPU_LIMIT__", fields.cpuLimit],
    ["__MEMORY__", fields.memory],
  ];
}

/** Filling the parsed values, not the text, keeps a value from changing the YAML around it. */
function fillValue(value: unknown, fields: Placeholders): unknown {
  if (typeof value === "string") return fillText(value, fields);
  if (Array.isArray(value)) return value.map((item) => fillValue(item, fields));
  if (objects.isRecord(value)) return fillObject(value, fields);
  return value;
}

function fillObject(value: KubeObject, fields: Placeholders): KubeObject {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillValue(v, fields)]));
}

/** A function replacement, so `$$` and `$&` in a value stay as they are. */
function fillText(text: string, fields: Placeholders): string {
  return fields.reduce((out, [field, value]) => out.replaceAll(field, () => value), text);
}

const JobSchema = z.object({
  metadata: z.object({ name: z.string(), creationTimestamp: z.string() }),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z.object({
            env: z.array(z.object({ name: z.string(), value: z.string().optional() })).default([]),
          }),
        ),
      }),
    }),
  }),
  status: z
    .object({
      active: z.number().default(0),
      succeeded: z.number().default(0),
      failed: z.number().default(0),
    })
    .prefault({}),
});

const JobListSchema = z.object({ items: z.array(JobSchema) });

const CreatedSchema = z.object({ metadata: z.object({ name: z.string() }) });

function endpoint(cluster: Cluster, apiPath: string): Endpoint {
  return {
    service: "kubernetes",
    url: `${cluster.server}${apiPath}`,
    headers: cluster.headers,
    errorCode: "kubernetes",
    tls: cluster.tls,
  };
}

const jobUrl = (cluster: Cluster, name: string): string => `${cluster.server}${JOBS_PATH}/${name}`;

/** The Jobs of the namespace that match the label selector, e.g. `app=tenyard`. */
async function listJobs(cluster: Cluster, selector: string): Promise<Job[]> {
  const apiPath = `${JOBS_PATH}?labelSelector=${encodeURIComponent(selector)}`;
  const list = await http.get({ endpoint: endpoint(cluster, apiPath), schema: JobListSchema });
  return list.items.map((item) => {
    const env = item.spec.template.spec.containers[0]?.env ?? [];
    return {
      name: item.metadata.name,
      cmd: env.find((e) => e.name === "TENBOX_CMD")?.value ?? "",
      ...item.status,
      created: item.metadata.creationTimestamp,
      url: jobUrl(cluster, item.metadata.name),
    };
  });
}

/** Creates the volume; an existing one (409) is kept with its files. */
async function ensureVolume(post: ObjectPost): Promise<void> {
  const { cluster, object } = post;
  await http.ensure({
    endpoint: endpoint(cluster, VOLUMES_PATH),
    schema: CreatedSchema,
    body: object,
  });
}

/** Creates the Secret, or replaces an existing one (409) whole: a key left out is removed. */
async function saveSecret(input: SecretInput): Promise<void> {
  const { cluster, name, values } = input;
  const body = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name },
    type: "Opaque",
    stringData: values,
  };
  const request = { endpoint: endpoint(cluster, SECRETS_PATH), schema: CreatedSchema, body };
  const created = await http.ensure(request);
  if (created !== null) return;
  await http.put({ ...request, endpoint: endpoint(cluster, `${SECRETS_PATH}/${name}`) });
}

/** Creates the Job; the API URL of the created Job. */
async function createJob(post: ObjectPost): Promise<string> {
  const { cluster, object } = post;
  const request = { endpoint: endpoint(cluster, JOBS_PATH), schema: CreatedSchema, body: object };
  const created = await http.post(request);
  return jobUrl(cluster, created.metadata.name);
}
