import { errorMessage } from "../../domain/errors/index.ts";
import {
  CLOSE_OUTPUT,
  closeOutput,
  closeOutputId,
  isClosed,
  JOB_FINISHED,
  type JobFinished,
  type JobFinishInput,
  jobChanges,
  jobEventId,
  jobFinished,
  type ListedPod,
  readJobFinished,
} from "../../domain/events.ts";
import { oomKilledInLog } from "../../domain/machines.ts";
import type { Db } from "../infra/db/index.ts";
import { type KubernetesApi, kubernetes } from "../infra/kubernetes.ts";
import { eventsRepository } from "../infra/repositories/events.ts";
import { events } from "./events.ts";

/** One poll: the pods of the last poll, and the poll time. */
interface JobPoll {
  kubernetes: KubernetesApi;
  seen: ListedPod[];
  at: Date;
}

interface JobWatch {
  kubernetes: KubernetesApi;
  now: () => Date;
}

/** One ended pod to read the boot log of and store. */
interface EndedPod {
  db: Db;
  pod: ListedPod;
  api: KubernetesApi;
  at: string;
}

/**
 * Stores a `job.finished` for each listed pod whose box container ended and for each pod of
 * `seen` that is no longer listed, unless its event is stored. The listed pods are the `seen`
 * of the next poll.
 */
async function poll(db: Db, input: JobPoll): Promise<ListedPod[]> {
  const listed = await kubernetes.jobPods(input.kubernetes);
  const ids = [...input.seen, ...listed].map((pod) => jobEventId(pod));
  const stored = new Set(eventsRepository.findIds(db, ids));
  const changes = jobChanges({ seen: input.seen, stored, listed });
  const at = input.at.toISOString();
  for (const pod of changes.gone) store(db, { pod, oomInLog: false, at });
  const api = input.kubernetes;
  await Promise.all(changes.ended.map((pod) => storeLogged({ db, pod, api, at })));
  return listed;
}

/** A poll for each tick of the cluster watch: it remembers the pods it saw, and logs a failure. */
function poller(db: Db, input: JobWatch): () => Promise<void> {
  let seen: ListedPod[] = [];
  return async () => {
    try {
      seen = await poll(db, { kubernetes: input.kubernetes, seen, at: input.now() });
    } catch (error) {
      logFailure(error, "job watch");
    }
  };
}

/** The `job.finished` bodies of one task, oldest `finished` first. */
function list(db: Db, task: string): JobFinished[] {
  return eventsRepository
    .findBySubject(db, { type: JOB_FINISHED, subject: task })
    .map((row) => readJobFinished(row.body, `event ${row.id}`));
}

/** A pod whose log the cluster cannot give is logged and asked again on the next poll. */
async function storeLogged(input: EndedPod): Promise<void> {
  try {
    await storeEnded(input);
  } catch (error) {
    logFailure(error, `job watch: pod ${input.pod.name}`);
  }
}

async function storeEnded(input: EndedPod): Promise<void> {
  const { db, pod, api, at } = input;
  if (isClosed(pod)) {
    const log = await kubernetes.boxLog({ api, pod: pod.name });
    storeCloseOutput(db, { pod, log, at });
    store(db, { pod, oomInLog: oomKilledInLog(log), at });
    return;
  }
  const line = await kubernetes.lastLogLine({ api, pod: pod.name });
  store(db, { pod, oomInLog: oomKilledInLog(line), at });
}

/** The log of a close pod that ended with exit code 0. */
interface CloseLog {
  pod: ListedPod;
  log: string;
  /** The poll time, for a pod with no box end. */
  at: string;
}

/** A log with no close output is one stderr line; the pod's `job.finished` is stored anyway. */
function storeCloseOutput(db: Db, input: CloseLog): void {
  const { pod, log, at } = input;
  const body = closeOutput(log);
  if (body === null) {
    logFailure(new Error("no close output in the log"), `job watch: pod ${pod.name}`);
    return;
  }
  events.saveFromServer(db, {
    id: closeOutputId(pod),
    type: CLOSE_OUTPUT,
    subject: pod.task,
    at: pod.end?.finished ?? at,
    body,
  });
}

function store(db: Db, input: JobFinishInput): void {
  const event = jobFinished(input);
  events.saveFromServer(db, {
    id: jobEventId(input.pod),
    type: event.event,
    subject: event.task,
    at: event.finished,
    body: event,
  });
}

function logFailure(error: unknown, what: string): void {
  console.error(`${what}: ${errorMessage(error)}`);
}

/** Machine runs: each pod of a task Job, stored once when its box container ends or its pod goes. */
export const machineRuns = { poll, poller, list };
