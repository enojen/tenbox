import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { z } from "zod";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const HTTP_CREATED = 201;
const HTTP_CONFLICT = 409;
const TOKEN = "SECRET-TOKEN";
const JOBS_PATH = "/apis/batch/v1/namespaces/tenbox/jobs";
const PVCS_PATH = "/api/v1/namespaces/tenbox/persistentvolumeclaims";
const SECRETS_PATH = "/api/v1/namespaces/tenbox/secrets";
const PROJECT_SECRET = "project-k7f3qa";
const TRACKER_KEY = "SECRET-TRACKER-KEY";
const NTFY_URL = "https://ntfy.sh/secret-topic";
const JOB_NAME = /^task-ten-1-\d{4}-\d{6}$/;
const CREATED = "2026-10-21T10:00:00Z";

let project: TempProject;
let claudeDir: string;
let env: Record<string, string>;

/** A shortened tenyard `task/job.yaml`: the fields tenbox fills and the tests read back. */
const JOB_TEMPLATE = `apiVersion: batch/v1
kind: Job
metadata:
  name: task-__NAME__-__RUN__
  labels: { app: tenyard, task: __TASK__ }
spec:
  template:
    metadata:
      labels: { app: tenyard, task: __TASK__, class: __CLASS__ }
    spec:
      containers:
        - name: box
          image: __IMAGE__
          resources:
            requests: { cpu: __CPU__, memory: __MEMORY__ }
            limits: { cpu: __CPU_LIMIT__, memory: __MEMORY__ }
          env:
            - { name: TENBOX_TASK, value: "__TASK__" }
            - { name: TENBOX_PROJECT, value: "__PROJECT__" }
            - { name: TENBOX_REPO, value: "__REPO__" }
            - name: TENBOX_CMD
              value: |-
                __CMD__
            - name: TENBOX_ENV
              value: |-
                __ENV__
            - name: TRACKER_API_KEY
              valueFrom: { secretKeyRef: { name: project-__PROJECT_ID__, key: tracker_api_key } }
      volumes:
        - name: home
          persistentVolumeClaim: { claimName: task-__NAME__ }
`;

const CLASSES = `plan: { cpu: 250m, cpu_limit: "2", memory: 1536Mi }
build: { cpu: 500m, cpu_limit: "4", memory: 2Gi }
heavy: { cpu: 500m, cpu_limit: "4", memory: 5Gi }
`;

const PVC_TEMPLATE = `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: task-__NAME__
  labels: { app: tenyard, task: __TASK__ }
`;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  claudeDir = path.join(project.root, "claude");
  // The tracker keys of the shell that runs the tests must not reach the Secret.
  env = { CLAUDE_CONFIG_DIR: claudeDir, CLICKUP_API_KEY: "", LINEAR_API_KEY: "" };
});

afterEach(() => project.remove());

const writeLogin = (expiresAt: number) =>
  files.write(
    path.join(claudeDir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "SECRET", refreshTokenExpiresAt: expiresAt } }),
  );

const machine = (args: string[]) => tenbox(["machine", ...args], project.mainDir, env);

/** One request the fake Kubernetes API got. */
interface ApiCall {
  method: string;
  path: string;
  query: string;
  auth: string | null;
  body: unknown;
}

/** A Kubernetes API server on 127.0.0.1 that logs each request. */
interface FakeApi {
  url: string;
  calls: ApiCall[];
  /** The answer status of the PVC POST. */
  pvcStatus: number;
  secretStatus: number;
  /** The items of every Job list. */
  jobs: unknown[];
  stop(): void;
}

function startFakeApi(): FakeApi {
  const api: FakeApi = {
    url: "",
    calls: [],
    pvcStatus: HTTP_CREATED,
    secretStatus: HTTP_CREATED,
    jobs: [],
    stop: () => {},
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const url = new URL(request.url);
      const body = await readBody(request);
      const auth = request.headers.get("authorization");
      api.calls.push({ method: request.method, path: url.pathname, query: url.search, auth, body });
      if (request.method === "GET") return Response.json({ items: api.jobs });
      if (url.pathname === PVCS_PATH) return Response.json(body, { status: api.pvcStatus });
      if (url.pathname === SECRETS_PATH) return Response.json(body, { status: api.secretStatus });
      return Response.json(body, { status: HTTP_CREATED });
    },
  });
  api.url = `http://127.0.0.1:${server.port}`;
  api.stop = () => server.stop(true);
  return api;
}

const readBody = (request: Request): Promise<unknown> =>
  request.method === "GET" ? Promise.resolve(null) : request.json();

const base64 = (text: string) => Buffer.from(text).toString("base64");

interface TokenUser {
  token: string;
}

/** The user entry of the tenyard kubeconfig. */
interface CertificateUser {
  "client-certificate-data": string;
  "client-key-data": string;
}

type KubeUser = TokenUser | CertificateUser;

interface KubeconfigInput {
  server: string;
  user: KubeUser;
}

function kubeconfig(input: KubeconfigInput): string {
  return JSON.stringify({
    apiVersion: "v1",
    "current-context": "tenyard",
    contexts: [{ name: "tenyard", context: { cluster: "c", user: "u" } }],
    clusters: [
      { name: "c", cluster: { server: input.server, "certificate-authority-data": base64("CA") } },
    ],
    users: [{ name: "u", user: input.user }],
  });
}

/** A posted Job body, as far as the tests read it. */
const JobBodySchema = z.object({
  metadata: z.object({ name: z.string(), labels: z.unknown() }),
  spec: z.object({
    template: z.object({
      metadata: z.object({ labels: z.record(z.string(), z.string()) }),
      spec: z.object({
        containers: z.array(
          z.object({
            resources: z.unknown(),
            env: z.array(
              z.object({
                name: z.string(),
                value: z.string().optional(),
                valueFrom: z.unknown().optional(),
              }),
            ),
          }),
        ),
      }),
    }),
  }),
});

const jobBody = (call: ApiCall | undefined) => JobBodySchema.parse(call?.body);

/** The env of the box container in a posted Job: the values, without the Secret refs. */
function jobEnv(call: ApiCall | undefined): Record<string, string> {
  const entries = jobBody(call).spec.template.spec.containers[0]?.env ?? [];
  return Object.fromEntries(
    entries.flatMap((e) => (e.value === undefined ? [] : [[e.name, e.value]])),
  );
}

/** The pod's class label and the resources of the box container in a posted Job. */
function jobClass(call: ApiCall | undefined) {
  const template = jobBody(call).spec.template;
  return {
    label: template.metadata.labels.class,
    resources: template.spec.containers[0]?.resources,
  };
}

/** The resources a class of `CLASSES` gives the box: the RAM request is its limit. */
function classResources(cpu: string, cpuLimit: string, memory: string) {
  return { requests: { cpu, memory }, limits: { cpu: cpuLimit, memory } };
}

/** The `valueFrom` of one env entry of the box container in a posted Job. */
function jobValueFrom(call: ApiCall | undefined, name: string): unknown {
  const entries = jobBody(call).spec.template.spec.containers[0]?.env ?? [];
  return entries.find((e) => e.name === name)?.valueFrom;
}

/** A Secret body, as far as the tests read it. */
const SecretBodySchema = z.object({
  metadata: z.object({ name: z.string() }),
  stringData: z.record(z.string(), z.string()),
});

const secretBody = (call: ApiCall | undefined) => SecretBodySchema.parse(call?.body);

interface FakeJobInput {
  name: string;
  status: Record<string, number>;
}

function fakeJob(input: FakeJobInput) {
  const env = [{ name: "TENBOX_CMD", value: "tenbox build TEN-1" }];
  return {
    metadata: { name: input.name, creationTimestamp: CREATED },
    spec: { template: { spec: { containers: [{ name: "box", env }] } } },
    status: input.status,
  };
}

describe("machine", () => {
  let api: FakeApi;
  let template: string;
  let kubeFile: string;

  const writeManifest = (lines: string) =>
    files.write(path.join(project.mainDir, "tenbox.yaml"), `project: demo\nid: k7f3qa\n${lines}`);

  const machineLine = () => `machine: { template: ${template} }\n`;

  const writeLocal = (text: string) =>
    files.write(path.join(project.mainDir, "tenbox.local.yaml"), text);

  const build = () => machine(["run", "TEN-1", "--", "tenbox", "build", "TEN-1"]);

  const posts = () => api.calls.filter((c) => c.method === "POST");

  beforeEach(async () => {
    api = startFakeApi();
    template = path.join(project.root, "tenyard", "task");
    kubeFile = path.join(project.root, "kubeconfig");
    await files.write(path.join(template, "job.yaml"), JOB_TEMPLATE);
    await files.write(path.join(template, "pvc.yaml"), PVC_TEMPLATE);
    await files.write(path.join(template, "classes.yaml"), CLASSES);
    await files.write(kubeFile, kubeconfig({ server: api.url, user: { token: TOKEN } }));
    await writeManifest(machineLine());
    await git.run(["remote", "add", "origin", "https://github.com/o/demo.git"], project.mainDir);
    await writeLogin(Date.now() + DAY_MS);
    env.KUBECONFIG = kubeFile;
  });

  afterEach(() => api.stop());

  test("machine run on k8s posts the project Secret, the PVC and the Job", async () => {
    const run = await build();
    expect(run.code).toBe(0);
    expect(posts().map((c) => c.path)).toEqual([SECRETS_PATH, PVCS_PATH, JOBS_PATH]);
    const [, pvc, job] = posts();
    expect(pvc?.body).toMatchObject({
      metadata: { name: "task-ten-1", labels: { task: "TEN-1" } },
    });
    const meta = jobBody(job).metadata;
    expect(meta.name).toMatch(JOB_NAME);
    expect(meta.labels).toEqual({ app: "tenyard", task: "TEN-1" });
    expect(jobEnv(job)).toEqual({
      TENBOX_TASK: "TEN-1",
      TENBOX_PROJECT: "demo",
      TENBOX_REPO: "https://github.com/o/demo.git",
      TENBOX_CMD: "tenbox build TEN-1",
      TENBOX_ENV: "{}",
    });
    expect(jobValueFrom(job, "TRACKER_API_KEY")).toEqual({
      secretKeyRef: { name: PROJECT_SECRET, key: "tracker_api_key" },
    });
    expect(posts().map((c) => c.auth)).toEqual(Array(3).fill(`Bearer ${TOKEN}`));
    expect(run.json).toEqual({
      ok: true,
      task: "TEN-1",
      cmd: "build",
      url: `${api.url}${JOBS_PATH}/${meta.name}`,
    });
    expect(run.out).not.toContain(TOKEN);
  });

  test("machine run on k8s keeps an existing PVC", async () => {
    api.pvcStatus = HTTP_CONFLICT;
    const run = await build();
    expect([run.code, run.json.ok]).toEqual([0, true]);
    expect(posts().map((c) => c.path)).toEqual([SECRETS_PATH, PVCS_PATH, JOBS_PATH]);
  });

  test("the project Secret holds the tracker key and the ntfy URL of the local manifest", async () => {
    await writeManifest(`${machineLine()}tracker: { kind: linear }\n`);
    await writeLocal(`tracker:\n  api_key: "${TRACKER_KEY}"\nnotify:\n  ntfy: "${NTFY_URL}"\n`);
    const run = await build();
    expect(run.code).toBe(0);
    const secret = secretBody(posts()[0]);
    expect(secret.metadata.name).toBe(PROJECT_SECRET);
    expect(secret.stringData).toEqual({ tracker_api_key: TRACKER_KEY, ntfy_url: NTFY_URL });
    expect(run.out).not.toContain(TRACKER_KEY);
  });

  test("without a key in the manifest the Secret takes the tracker's env variable", async () => {
    await writeManifest(`${machineLine()}tracker: { kind: clickup }\n`);
    env.CLICKUP_API_KEY = TRACKER_KEY;
    env.LINEAR_API_KEY = "SECRET-OTHER-TRACKER";
    const run = await build();
    expect(run.code).toBe(0);
    expect(secretBody(posts()[0]).stringData).toEqual({ tracker_api_key: TRACKER_KEY });
  });

  test("a project with no tracker and no ntfy gets an empty Secret, no key of the shell", async () => {
    env.LINEAR_API_KEY = TRACKER_KEY;
    const run = await build();
    expect(run.code).toBe(0);
    expect(secretBody(posts()[0]).stringData).toEqual({});
  });

  test("an existing project Secret is replaced", async () => {
    api.secretStatus = HTTP_CONFLICT;
    await writeLocal(`notify:\n  ntfy: "${NTFY_URL}"\n`);
    const run = await build();
    expect(run.code).toBe(0);
    const writes = api.calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => [c.method, c.path])).toEqual([
      ["POST", SECRETS_PATH],
      ["PUT", `${SECRETS_PATH}/${PROJECT_SECRET}`],
      ["POST", PVCS_PATH],
      ["POST", JOBS_PATH],
    ]);
    expect(secretBody(writes[1]).stringData).toEqual({ ntfy_url: NTFY_URL });
  });

  test("a project without an id is no-project-id before any request", async () => {
    await files.write(path.join(project.mainDir, "tenbox.yaml"), `project: demo\n${machineLine()}`);
    const run = await build();
    expect([run.code, run.json.code]).toEqual([1, "no-project-id"]);
    expect(String(run.json.error)).toContain("tenbox.yaml");
    expect(api.calls).toEqual([]);
  });

  test("machine run without a kubeconfig fails before any request", async () => {
    env.KUBECONFIG = path.join(project.root, "missing");
    const run = await build();
    expect([run.code, run.json.code]).toEqual([1, "no-kubeconfig"]);
    expect(api.calls).toEqual([]);
  });

  test("an expired refresh token is login-expired, mentions /login and sends no request", async () => {
    await writeLogin(Date.now() - MINUTE_MS);
    const run = await build();
    expect([run.code, run.json.code]).toEqual([1, "login-expired"]);
    expect(String(run.json.error)).toContain("/login");
    expect(run.out).not.toContain("SECRET");
    expect(api.calls).toEqual([]);
  });

  test("a missing .credentials.json is no-login and sends no request", async () => {
    await files.remove(path.join(claudeDir, ".credentials.json"));
    const run = await build();
    expect([run.code, run.json.code]).toEqual([1, "no-login"]);
    expect(api.calls).toEqual([]);
  });

  test.each([
    ["another id", ["run", "TEN-1", "--", "tenbox", "build", "TEN-2"]],
    ["another command", ["run", "TEN-1", "--", "tenbox", "check", "TEN-1"]],
    ["no --", ["run", "TEN-1"]],
    ["words without --", ["run", "TEN-1", "tenbox", "build", "TEN-1"]],
    ["a flag of another command", ["run", "TEN-1", "--", "tenbox", "build", "TEN-1", "--force"]],
    ["--title without a title", ["run", "TEN-1", "--", "tenbox", "start", "TEN-1", "--title"]],
  ])("%s is a usage error before any request", async (_name, args) => {
    const run = await machine(args);
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
    expect(api.calls).toEqual([]);
  });

  test("machine.env reaches TENBOX_ENV as one JSON object", async () => {
    const env = `env: { TEST_MAX_WORKERS: "1", GREETING: "it's $(x)" }`;
    await writeManifest(`machine: { template: ${template}, ${env} }\n`);
    const run = await build();
    expect(run.code).toBe(0);
    const job = posts().find((c) => c.path === JOBS_PATH);
    expect(jobEnv(job).TENBOX_ENV).toBe(`{"TEST_MAX_WORKERS":"1","GREETING":"it's $(x)"}`);
  });

  test.each([
    ["start", ["tenbox", "start", "TEN-1"]],
    ["close", ["tenbox", "close", "TEN-1"]],
  ])("%s runs in the plan class", async (_name, words) => {
    await writeManifest(`machine: { template: ${template}, class: heavy }\n`);
    const run = await machine(["run", "TEN-1", "--", ...words]);
    expect(run.code).toBe(0);
    const job = posts().find((c) => c.path === JOBS_PATH);
    expect(jobClass(job)).toEqual({
      label: "plan",
      resources: classResources("250m", "2", "1536Mi"),
    });
  });

  test("a build runs in the build class by default", async () => {
    const run = await build();
    expect(run.code).toBe(0);
    const job = posts().find((c) => c.path === JOBS_PATH);
    expect(jobClass(job)).toEqual({
      label: "build",
      resources: classResources("500m", "4", "2Gi"),
    });
  });

  test("a build runs in the class of machine.class", async () => {
    await writeManifest(`machine: { template: ${template}, class: heavy }\n`);
    const run = await build();
    expect(run.code).toBe(0);
    const job = posts().find((c) => c.path === JOBS_PATH);
    expect(jobClass(job)).toEqual({
      label: "heavy",
      resources: classResources("500m", "4", "5Gi"),
    });
  });

  test("a class that classes.yaml does not have is a template error before any request", async () => {
    await files.write(path.join(template, "classes.yaml"), CLASSES.replace(/^heavy:.*\n/m, ""));
    await writeManifest(`machine: { template: ${template}, class: heavy }\n`);
    const run = await build();
    expect([run.code, run.json.code]).toEqual([1, "template"]);
    expect(String(run.json.error)).toContain('no class "heavy" (plan, build)');
    expect(api.calls).toEqual([]);
  });

  test.each([
    ["missing", null],
    ["a class without memory", `build: { cpu: 500m, cpu_limit: "4" }\n`],
  ])("a classes.yaml that is %s is a template error before any request", async (_name, text) => {
    const file = path.join(template, "classes.yaml");
    if (text === null) await files.remove(file);
    else await files.write(file, text);
    const run = await build();
    expect([run.code, run.json.code]).toEqual([1, "template"]);
    expect(String(run.json.error)).toContain("classes.yaml");
    expect(api.calls).toEqual([]);
  });

  test("close --force reaches TENBOX_CMD", async () => {
    const run = await machine(["run", "TEN-1", "--", "tenbox", "close", "TEN-1", "--force"]);
    expect(run.code).toBe(0);
    const job = posts().find((c) => c.path === JOBS_PATH);
    expect(jobEnv(job).TENBOX_CMD).toBe("tenbox close TEN-1 --force");
  });

  test("a token in the origin url does not reach the Job", async () => {
    const origin = "https://x-access-token:ghp_secret@github.com/o/demo.git";
    await git.run(["remote", "set-url", "origin", origin], project.mainDir);
    const run = await machine(["run", "TEN-1", "--", "tenbox", "start", "TEN-1"]);
    expect(run.code).toBe(0);
    const job = posts().find((c) => c.path === JOBS_PATH);
    expect(jobEnv(job).TENBOX_REPO).toBe("https://github.com/o/demo.git");
    expect(JSON.stringify(api.calls)).not.toContain("ghp_secret");
  });

  test.each([
    ["a string", "machine: k8s\n"],
    ["the kind key", "machine: { kind: k8s }\n"],
  ])("machine as %s is a manifest error", async (_name, line) => {
    await writeManifest(line);
    const run = await build();
    expect([run.code, run.json.code]).toEqual([1, "manifest"]);
    expect(String(run.json.error)).toContain("machine");
    expect(api.calls).toEqual([]);
  });

  test("machine ls on k8s lists the Jobs with their state", async () => {
    api.jobs = [
      fakeJob({ name: "task-ten-1-1021-100000", status: { active: 1 } }),
      fakeJob({ name: "task-ten-2-1021-090000", status: { succeeded: 1 } }),
    ];
    const run = await machine(["ls"]);
    const row = (id: string) => ({
      id,
      title: "tenbox build TEN-1",
      url: `${api.url}${JOBS_PATH}/${id}`,
      created: CREATED,
    });
    expect(run.json).toEqual({
      ok: true,
      runs: [
        { ...row("task-ten-1-1021-100000"), status: "in_progress", conclusion: null },
        { ...row("task-ten-2-1021-090000"), status: "completed", conclusion: "success" },
      ],
    });
    expect(api.calls.map((c) => [c.method, c.path, c.query])).toEqual([
      ["GET", JOBS_PATH, "?labelSelector=app%3Dtenyard"],
    ]);
  });

  test("a failed Job is completed with conclusion failure", async () => {
    api.jobs = [fakeJob({ name: "task-ten-1-1021-100000", status: { failed: 1 } })];
    const run = await machine(["ls"]);
    expect(run.json.runs).toMatchObject([{ status: "completed", conclusion: "failure" }]);
  });

  test("a run refuses with machine-busy while a Job of the task is active", async () => {
    api.jobs = [fakeJob({ name: "task-ten-1-1021-100000", status: { active: 1 } })];
    const run = await build();
    expect([run.code, run.json.code]).toEqual([1, "machine-busy"]);
    expect(String(run.json.error)).toContain("task-ten-1-1021-100000");
    expect(api.calls.map((c) => [c.method, c.query])).toEqual([
      ["GET", "?labelSelector=task%3DTEN-1"],
    ]);
  });

  test("a missing job.yaml is a template error before any request", async () => {
    await files.remove(path.join(template, "job.yaml"));
    const run = await build();
    expect([run.code, run.json.code]).toEqual([1, "template"]);
    expect(String(run.json.error)).toContain("job.yaml");
    expect(api.calls).toEqual([]);
  });

  test("the title reaches TENBOX_CMD quoted for the shell", async () => {
    const words = ["tenbox", "start", "TEN-1", "--title", "Fix it's $(x)"];
    const run = await machine(["run", "TEN-1", "--", ...words]);
    expect(run.code).toBe(0);
    const job = posts().find((c) => c.path === JOBS_PATH);
    expect(jobEnv(job).TENBOX_CMD).toBe(`tenbox start TEN-1 --title 'Fix it'\\''s $(x)'`);
  });

  test("a client certificate and key are sent without a token", async () => {
    const user = { "client-certificate-data": base64("CERT"), "client-key-data": base64("KEY") };
    await files.write(kubeFile, kubeconfig({ server: api.url, user }));
    const run = await build();
    expect(run.code).toBe(0);
    expect(api.calls.map((c) => c.auth)).toEqual([null, null, null, null]);
    expect(run.out).not.toContain(base64("KEY"));
  });
});
