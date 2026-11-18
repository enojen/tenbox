import { z } from "zod";
import { type GitAuthor, RUN_PHASE } from "../../domain/machines.ts";
import type { TenportServer } from "./env.ts";
import { type Endpoint, failedStatus, http, wasUnreached } from "./http.ts";

interface EventsPost {
  server: TenportServer;
  events: unknown[];
}

const HTTP_CONFLICT = 409;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
/** Tenport has one writer: a deploy leaves it without an answer for a few seconds. */
const RETRY_ATTEMPTS = 10;
const RETRY_MS = 1000;
/** The most runs one `GET /runs` page holds. */
const RUNS_PAGE = 100;

const RecordedSchema = z.object({ stored: z.number(), skipped: z.number() });

/** `POST /runs`: one tenbox command of a task as a Job on the cluster. */
export interface NewRun {
  project: string;
  task: string;
  /** `tenbox <command> <task> [flags]`. */
  command: string[];
  base: string;
  class: string;
  setup?: string;
  author: GitAuthor;
  services: string[];
  env: Record<string, string>;
}

const StartedRunSchema = z.object({ name: z.string() });

/** One run as Tenport keeps it, also after its Job is gone. */
const RunStateSchema = z.object({
  name: z.string(),
  project: z.string(),
  task: z.string(),
  command: z.string(),
  class: z.string(),
  created: z.string(),
  phase: z.enum(RUN_PHASE),
  reason: z.string().nullable().default(null),
  exit_code: z.number().nullable().default(null),
  oom_kill: z.number().nullable().default(null),
  output: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type RunState = z.infer<typeof RunStateSchema>;

interface RunStart {
  server: TenportServer;
  run: NewRun;
}

/** One run by its name. */
interface RunRef {
  server: TenportServer;
  name: string;
}

interface TaskRuns {
  server: TenportServer;
  project: string;
  task: string;
}

interface LogRead extends RunRef {
  follow: boolean;
}

interface ProjectSecret {
  server: TenportServer;
  project: string;
  name: string;
  value: string;
}

export const tenport = {
  sendEvents,
  startRun,
  findRun,
  listRuns,
  stopRun,
  streamLog,
  saveProjectSecret,
};

async function sendEvents(post: EventsPost): Promise<void> {
  const { server, events } = post;
  try {
    await http.post({
      endpoint: endpoint(server, "/events"),
      body: events,
      schema: RecordedSchema,
    });
  } catch (e) {
    if (failedStatus(e) !== HTTP_CONFLICT) throw e;
  }
}

/** The name of the started run. */
async function startRun(start: RunStart): Promise<string> {
  const { server, run } = start;
  const request = { endpoint: endpoint(server, "/runs"), body: run, schema: StartedRunSchema };
  const started = await retried(() => http.post(request));
  return started.name;
}

function findRun(ref: RunRef): Promise<RunState> {
  const { server, name } = ref;
  const request = { endpoint: endpoint(server, runPath(name)), schema: RunStateSchema };
  return retried(() => http.get(request));
}

/** Every run of the task, oldest first. */
async function listRuns(task: TaskRuns): Promise<RunState[]> {
  const runs: RunState[] = [];
  let page = await listPage(task, null);
  runs.push(...page);
  while (page.length === RUNS_PAGE) {
    page = await listPage(task, runs.at(-1)?.name ?? null);
    runs.push(...page);
  }
  return runs;
}

function listPage(task: TaskRuns, after: string | null): Promise<RunState[]> {
  const { server, project } = task;
  const query = new URLSearchParams({ project, task: task.task, limit: String(RUNS_PAGE) });
  if (after !== null) query.set("after", after);
  const request = {
    endpoint: endpoint(server, `/runs?${query.toString()}`),
    schema: z.array(RunStateSchema),
  };
  return retried(() => http.get(request));
}

/** Deletes the Job of a run; false when Tenport does not know the run. */
function stopRun(ref: RunRef): Promise<boolean> {
  return retried(() => http.remove(endpoint(ref.server, runPath(ref.name))));
}

function streamLog(read: LogRead): Promise<AsyncIterable<string>> {
  const { server, name, follow } = read;
  const target = endpoint(server, `${runPath(name)}/log?follow=${String(follow)}`);
  return retried(() => http.stream({ endpoint: target, unlimited: follow }));
}

/** `PUT /projects/{project}/secrets/{name}`: a value the Job template of the project reads. */
async function saveProjectSecret(secret: ProjectSecret): Promise<void> {
  const { server, project, name, value } = secret;
  const path = `/projects/${encodeURIComponent(project)}/secrets/${encodeURIComponent(name)}`;
  const request = { endpoint: endpoint(server, path), body: { value }, schema: z.unknown() };
  await retried(() => http.put(request));
}

const runPath = (name: string): string => `/runs/${encodeURIComponent(name)}`;

function endpoint(server: TenportServer, path: string): Endpoint {
  return {
    service: "tenport",
    url: `${server.url.replace(/\/+$/, "")}${path}`,
    headers: { Authorization: `Bearer ${server.token}` },
    errorCode: "tenport",
  };
}

/** Asks again while Tenport gives no answer, as during a deploy, for a few seconds. */
async function retried<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (e) {
      if (attempt === RETRY_ATTEMPTS || !isGap(e)) throw e;
      await Bun.sleep(RETRY_MS);
    }
  }
}

function isGap(error: unknown): boolean {
  const status = failedStatus(error);
  return wasUnreached(error) || status === HTTP_BAD_GATEWAY || status === HTTP_SERVICE_UNAVAILABLE;
}
