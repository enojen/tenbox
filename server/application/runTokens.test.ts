import { afterEach, expect, spyOn, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "bun";
import { z } from "zod";
import { projectId } from "../../domain/ids.ts";
import { runPlaceholder } from "../../domain/runTokens.ts";
import { jsons } from "../../domain/utils.ts";
import { type Db, database } from "../infra/db/index.ts";
import type { GitHubApp } from "../infra/github.ts";
import type { KubernetesApi } from "../infra/kubernetes.ts";
import { projects } from "./projects.ts";
import { type RunTokenWatch, runTokens } from "./runTokens.ts";
import { trackerKeys } from "./trackerKeys.ts";

const TOKEN = "sa-token";
const APP_ID = "123456";
const INSTALLATION = 987654;
const RUN_TOKEN = "ghs_run";
const EXPIRES = "2026-11-08T18:00:00Z";
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;
const JOBS_PATH = "/apis/batch/v1/namespaces/tenbox/jobs";
const SECRETS_PATH = "/api/v1/namespaces/tenbox/secrets";
const DEMO_ID = "k7f3qa";
const NOW = new Date("2026-11-08T17:00:00Z");
const KEY = "run-credential-key";
const LATE = new Date("2026-11-08T17:55:00Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const CLICKUP_KEY = "pk_demo_secret";
const OTHER_ID = "rsgjhl";

interface FakeJob {
  name: string;
  uid: string;
  projectId?: string;
  ended?: string;
}

interface Fakes {
  db: Db;
  jobs: FakeJob[];
  kubernetes: KubernetesApi;
  github: GitHubApp;
  installed: string[];
  secrets: SecretBody[];
  secretStatuses: number[];
  tokenRequests: unknown[];
  tokenStatuses: number[];
  verifiedIssuers: string[];
}

const SecretBodySchema = z.object({
  metadata: z.object({
    name: z.string(),
    ownerReferences: z.array(z.object({ kind: z.string(), name: z.string(), uid: z.string() })),
  }),
  stringData: z.object({ token: z.string(), tracker: z.string().optional() }),
});

type SecretBody = z.infer<typeof SecretBodySchema>;

const ClaimsSchema = z.object({ iss: z.string() });

const roots: string[] = [];
const servers: Server<undefined>[] = [];
const dbs: Db[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) database.close(db);
  for (const server of servers.splice(0)) server.stop(true);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

const DEMO_JOB: FakeJob = { name: "task-demo-1-1108-170000", uid: "job-uid-1", projectId: DEMO_ID };

function jobItem(job: FakeJob): unknown {
  const labels = { app: "tenyard", task: "DEMO-1" };
  return {
    metadata: {
      name: job.name,
      uid: job.uid,
      labels: job.projectId === undefined ? labels : { ...labels, "project-id": job.projectId },
    },
    status: job.ended === undefined ? {} : { conditions: [{ type: job.ended, status: "True" }] },
  };
}

async function answerCluster(fakes: Fakes, request: Request): Promise<Response> {
  if (request.headers.get("Authorization") !== `Bearer ${TOKEN}`) {
    return new Response("", { status: HTTP_UNAUTHORIZED });
  }
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === SECRETS_PATH) {
    const text = await request.text();
    const checked = jsons.check(SecretBodySchema, text);
    if (!checked.ok) return new Response("bad secret", { status: HTTP_BAD_REQUEST });
    fakes.secrets.push(checked.value);
    const status = fakes.secretStatuses.shift() ?? HTTP_CREATED;
    return new Response("{}", { status });
  }
  if (url.pathname !== JOBS_PATH || url.searchParams.get("labelSelector") !== "app=tenyard") {
    return new Response("", { status: HTTP_NOT_FOUND });
  }
  return Response.json({ kind: "JobList", items: fakes.jobs.map(jobItem) });
}

function verifiedIssuer(request: Request, publicKey: crypto.KeyObject): string | null {
  const jwt = request.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const [header, payload, signature] = jwt.split(".");
  if (header === undefined || payload === undefined || signature === undefined) return null;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  if (!verifier.verify(publicKey, Buffer.from(signature, "base64url"))) return null;
  const claims = jsons.check(ClaimsSchema, Buffer.from(payload, "base64url").toString());
  return claims.ok ? claims.value.iss : null;
}

async function answerGitHub(
  fakes: Fakes,
  publicKey: crypto.KeyObject,
  request: Request,
): Promise<Response> {
  const issuer = verifiedIssuer(request, publicKey);
  if (issuer === null) return new Response("bad jwt", { status: HTTP_UNAUTHORIZED });
  fakes.verifiedIssuers.push(issuer);
  const url = new URL(request.url);
  const installation = /^\/repos\/([^/]+\/[^/]+)\/installation$/.exec(url.pathname);
  if (request.method === "GET" && installation?.[1] !== undefined) {
    if (!fakes.installed.includes(installation[1]))
      return new Response("", { status: HTTP_NOT_FOUND });
    return Response.json({ id: INSTALLATION });
  }
  if (
    request.method === "POST" &&
    url.pathname === `/app/installations/${INSTALLATION}/access_tokens`
  ) {
    const body: unknown = await request.json();
    fakes.tokenRequests.push(body);
    const status = fakes.tokenStatuses.shift() ?? HTTP_CREATED;
    if (status !== HTTP_CREATED) return new Response("down", { status });
    return Response.json({ token: RUN_TOKEN, expires_at: EXPIRES }, { status });
  }
  return new Response("", { status: HTTP_NOT_FOUND });
}

function setup(jobs: FakeJob[]): Fakes {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-run-tokens-"));
  roots.push(root);
  const tokenFile = path.join(root, "token");
  const caFile = path.join(root, "ca.crt");
  fs.writeFileSync(tokenFile, `${TOKEN}\n`);
  fs.writeFileSync(caFile, "a CA");
  const db = database.open(path.join(root, "server.db"));
  dbs.push(db);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const fakes: Fakes = {
    db,
    jobs,
    kubernetes: { url: "", tokenFile, caFile },
    github: { url: "", appId: APP_ID, key },
    installed: ["enojen/tenbox-demo"],
    secrets: [],
    secretStatuses: [],
    tokenRequests: [],
    tokenStatuses: [],
    verifiedIssuers: [],
  };
  const cluster = Bun.serve({ port: 0, fetch: (request) => answerCluster(fakes, request) });
  const github = Bun.serve({
    port: 0,
    fetch: (request) => answerGitHub(fakes, publicKey, request),
  });
  servers.push(cluster, github);
  fakes.kubernetes = { ...fakes.kubernetes, url: cluster.url.origin };
  fakes.github = { ...fakes.github, url: github.url.origin };
  return fakes;
}

function addDemo(db: Db): void {
  projects.save(db, {
    id: projectId(DEMO_ID),
    name: "tenbox-demo",
    repo: "github.com/enojen/tenbox-demo",
    org: "enojen",
  });
}

function watch(fakes: Fakes, now: () => Date = () => NOW): RunTokenWatch {
  return {
    kubernetes: fakes.kubernetes,
    github: fakes.github,
    key: KEY,
    encryptionKey: ENCRYPTION_KEY,
    now,
    tokens: new Map(),
  };
}

function addClickUpKey(db: Db, id: string, key: string): void {
  trackerKeys.update(db, {
    project: projectId(id),
    tracker: "clickup",
    key,
    encryptionKey: ENCRYPTION_KEY,
  });
}

function addOther(db: Db): void {
  projects.save(db, {
    id: projectId(OTHER_ID),
    name: "other",
    repo: "github.com/enojen/other",
    org: "enojen",
  });
}

function poller(fakes: Fakes): () => Promise<void> {
  return runTokens.poller(fakes.db, watch(fakes));
}

const DEMO_PLACEHOLDER = runPlaceholder(KEY, DEMO_JOB.uid);

test("an open Job of a project gets a Secret with its placeholder, after a token for its repository only", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  await poller(fakes)();
  expect(fakes.tokenRequests).toEqual([
    {
      repositories: ["tenbox-demo"],
      permissions: { contents: "write", pull_requests: "write", issues: "write" },
    },
  ]);
  expect(fakes.verifiedIssuers).toEqual([APP_ID, APP_ID]);
  expect(fakes.secrets).toHaveLength(1);
  const secret = fakes.secrets[0];
  expect(secret?.metadata.name).toBe("task-demo-1-1108-170000-github");
  expect(secret?.metadata.ownerReferences).toEqual([
    expect.objectContaining({ kind: "Job", name: DEMO_JOB.name, uid: DEMO_JOB.uid }),
  ]);
  expect(secret?.stringData).toEqual({ token: DEMO_PLACEHOLDER });
});

test("a Job gets its Secret once, over many polls", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  const poll = poller(fakes);
  await poll();
  await poll();
  expect(fakes.secrets).toHaveLength(1);
  expect(fakes.tokenRequests).toHaveLength(1);
});

test("a Secret that exists already counts as written", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  fakes.secretStatuses = [HTTP_CONFLICT];
  const poll = poller(fakes);
  await poll();
  await poll();
  expect(fakes.secrets).toHaveLength(1);
});

test("a repository without the App gets an empty token", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  fakes.installed = [];
  await poller(fakes)();
  expect(fakes.tokenRequests).toEqual([]);
  expect(fakes.secrets.map((secret) => secret.stringData)).toEqual([{ token: "" }]);
});

test("a project the server does not know gets an empty token without asking GitHub", async () => {
  const fakes = setup([DEMO_JOB]);
  await poller(fakes)();
  expect(fakes.verifiedIssuers).toEqual([]);
  expect(fakes.secrets.map((secret) => secret.stringData)).toEqual([{ token: "" }]);
});

test("an ended Job and a Job without a project id get no Secret", async () => {
  const fakes = setup([
    { ...DEMO_JOB, ended: "Complete" },
    { ...DEMO_JOB, name: "task-demo-2", uid: "job-uid-2", ended: "Failed" },
    { name: "task-old-1", uid: "job-uid-3" },
  ]);
  addDemo(fakes.db);
  await poller(fakes)();
  expect(fakes.secrets).toEqual([]);
});

test("a token GitHub cannot give is logged and asked again on the next poll", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  fakes.tokenStatuses = [HTTP_SERVER_ERROR];
  const logged = spyOn(console, "error").mockImplementation(() => undefined);
  const poll = poller(fakes);
  await poll();
  expect(fakes.secrets).toEqual([]);
  expect(String(logged.mock.calls[0]?.[0])).toContain(DEMO_JOB.name);
  await poll();
  logged.mockRestore();
  expect(fakes.secrets.map((secret) => secret.stringData)).toEqual([{ token: DEMO_PLACEHOLDER }]);
});

test("a failed Secret write is asked again on the next poll", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  fakes.secretStatuses = [HTTP_SERVER_ERROR, HTTP_OK];
  const logged = spyOn(console, "error").mockImplementation(() => undefined);
  const poll = poller(fakes);
  await poll();
  await poll();
  logged.mockRestore();
  expect(fakes.secrets).toHaveLength(2);
});

test("the placeholder of an open Job gives the token of its repository on GitHub's hosts", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  const watching = watch(fakes);
  for (const host of ["api.github.com", "github.com"]) {
    const value = await runTokens.resolve({
      db: fakes.db,
      watch: watching,
      placeholder: DEMO_PLACEHOLDER,
      host,
    });
    expect(value).toBe(RUN_TOKEN);
  }
  expect(fakes.tokenRequests).toEqual([expect.objectContaining({ repositories: ["tenbox-demo"] })]);
});

test("another host, an unknown placeholder or an ended Job gives nothing", async () => {
  const fakes = setup([
    DEMO_JOB,
    { ...DEMO_JOB, name: "task-demo-2", uid: "job-uid-2", ended: "Complete" },
  ]);
  addDemo(fakes.db);
  const watching = watch(fakes);
  const asked = [
    { placeholder: DEMO_PLACEHOLDER, host: "api.linear.app" },
    { placeholder: runPlaceholder("another-key", DEMO_JOB.uid), host: "github.com" },
    { placeholder: runPlaceholder(KEY, "job-uid-2"), host: "github.com" },
  ];
  for (const ask of asked) {
    const value = await runTokens.resolve({ db: fakes.db, watch: watching, ...ask });
    expect(value).toBeNull();
  }
  expect(fakes.tokenRequests).toEqual([]);
});

test("a repository without the App gives nothing", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  fakes.installed = [];
  const value = await runTokens.resolve({
    db: fakes.db,
    watch: watch(fakes),
    placeholder: DEMO_PLACEHOLDER,
    host: "github.com",
  });
  expect(value).toBeNull();
});

test("a token is minted again when less than 10 minutes are left", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  let now = NOW;
  const watching = watch(fakes, () => now);
  const ask = { db: fakes.db, watch: watching, placeholder: DEMO_PLACEHOLDER, host: "github.com" };
  await runTokens.resolve(ask);
  await runTokens.resolve(ask);
  expect(fakes.tokenRequests).toHaveLength(1);
  now = LATE;
  await runTokens.resolve(ask);
  expect(fakes.tokenRequests).toHaveLength(2);
});

test("the token the watch mints for the Secret is the first one resolve gives", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  const watching = watch(fakes);
  await runTokens.poller(fakes.db, watching)();
  const ask = { db: fakes.db, watch: watching, placeholder: DEMO_PLACEHOLDER, host: "github.com" };
  const value = await runTokens.resolve(ask);
  expect(value).toBe(RUN_TOKEN);
  expect(fakes.tokenRequests).toHaveLength(1);
});

test("a project with a tracker key gets the same placeholder for its tracker", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  addClickUpKey(fakes.db, DEMO_ID, CLICKUP_KEY);
  await poller(fakes)();
  expect(fakes.secrets.map((secret) => secret.stringData)).toEqual([
    { token: DEMO_PLACEHOLDER, tracker: DEMO_PLACEHOLDER },
  ]);
});

test("the placeholder gives the project's tracker key on its tracker's host only", async () => {
  const fakes = setup([DEMO_JOB]);
  addDemo(fakes.db);
  addClickUpKey(fakes.db, DEMO_ID, CLICKUP_KEY);
  const ask = { db: fakes.db, watch: watch(fakes), placeholder: DEMO_PLACEHOLDER };
  const clickup = await runTokens.resolve({ ...ask, host: "api.clickup.com" });
  const linear = await runTokens.resolve({ ...ask, host: "api.linear.app" });
  const app = await runTokens.resolve({ ...ask, host: "app.clickup.com" });
  expect(clickup).toBe(CLICKUP_KEY);
  expect(linear).toBeNull();
  expect(app).toBeNull();
  expect(fakes.tokenRequests).toEqual([]);
});

test("each Job gets the tracker key of its own project; a project without one gets nothing", async () => {
  const otherJob: FakeJob = { name: "task-other-1", uid: "job-uid-2", projectId: OTHER_ID };
  const fakes = setup([DEMO_JOB, otherJob]);
  addDemo(fakes.db);
  addOther(fakes.db);
  const watching = watch(fakes);
  const otherPlaceholder = runPlaceholder(KEY, otherJob.uid);
  const ask = { db: fakes.db, watch: watching, host: "api.clickup.com" };
  const before = await runTokens.resolve({ ...ask, placeholder: DEMO_PLACEHOLDER });
  expect(before).toBeNull();
  addClickUpKey(fakes.db, OTHER_ID, "pk_other_secret");
  const other = await runTokens.resolve({ ...ask, placeholder: otherPlaceholder });
  const demo = await runTokens.resolve({ ...ask, placeholder: DEMO_PLACEHOLDER });
  expect(other).toBe("pk_other_secret");
  expect(demo).toBeNull();
});

test("the placeholder of an ended Job gives no tracker key", async () => {
  const fakes = setup([{ ...DEMO_JOB, ended: "Complete" }]);
  addDemo(fakes.db);
  addClickUpKey(fakes.db, DEMO_ID, CLICKUP_KEY);
  const value = await runTokens.resolve({
    db: fakes.db,
    watch: watch(fakes),
    placeholder: DEMO_PLACEHOLDER,
    host: "api.clickup.com",
  });
  expect(value).toBeNull();
});
