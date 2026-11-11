import { errorMessage } from "../../domain/errors/index.ts";
import {
  CLOSE_OUTPUT,
  type ListedVolume,
  type NewVolume,
  type Price,
  readVolumeEvent,
  VOLUME_EVENT_NAMES,
  VOLUME_IDLE,
  type VolumeAction,
  type VolumeAdded,
  type VolumeEvent,
  type VolumeNotice,
  volumeAction,
  volumeAdded,
  volumeChanges,
  volumeEventId,
  volumeIdle,
  volumeIdleId,
  volumeRemoved,
  volumesUp,
} from "../../domain/events.ts";
import { taskId } from "../../domain/ids.ts";
import { NOTIFICATION_STATE, notificationLine } from "../../domain/notifications.ts";
import type { Db } from "../infra/db/index.ts";
import type { VolumeEnv } from "../infra/env.ts";
import { type HetznerApi, hetzner } from "../infra/hetzner.ts";
import { type KubernetesApi, kubernetes } from "../infra/kubernetes.ts";
import { ntfy } from "../infra/ntfy.ts";
import { eventsRepository } from "../infra/repositories/events.ts";
import { events } from "./events.ts";
import { machineRuns } from "./machineRuns.ts";

const WATCH = "volume watch";

/** Where the volume watch reads the PVCs and the volume price. */
interface VolumeApis {
  kubernetes: KubernetesApi;
  hetzner: HetznerApi;
}

/** One poll: the time of a removal it finds, whether the volume went while the server was down, the time now and the volume rules. */
interface VolumePoll extends VolumeApis {
  removedAt: Date;
  late: boolean;
  now: Date;
  /** Null: the watch only records volumes; it deletes and sends nothing. */
  env: VolumeEnv | null;
}

interface VolumeWatch extends VolumeApis {
  now: () => Date;
  env: VolumeEnv | null;
}

/** The live volumes of one poll, the time and the rules they go by. */
interface VolumeRules {
  listed: ListedVolume[];
  kubernetes: KubernetesApi;
  env: VolumeEnv;
  now: Date;
}

/** One idle notice to send to the ntfy topic URL and store. */
interface NoticeSend {
  notice: VolumeNotice;
  url: string;
  now: Date;
}

/** The new volumes of one poll, to price and store. */
interface NewVolumes {
  db: Db;
  volumes: ListedVolume[];
  api: HetznerApi;
}

/** One volume event to store and the time it happened. */
interface StoredVolumeEvent {
  db: Db;
  event: VolumeEvent;
  at: string;
}

/** Stores a `volume.added` for each new Bound task PVC and a `volume.removed` for each one gone. */
async function poll(db: Db, input: VolumePoll): Promise<void> {
  const listed = await kubernetes.taskVolumes(input.kubernetes);
  const changes = volumeChanges({ stored: storedEvents(db), listed });
  const at = input.removedAt.toISOString();
  for (const added of changes.removed) {
    store({ db, event: volumeRemoved({ added, late: input.late }), at });
  }
  await addAll({ db, volumes: changes.added, api: input.hetzner });
  const { env, now } = input;
  if (env !== null) await applyLogged(db, { listed, kubernetes: input.kubernetes, env, now });
}

/**
 * A poll for each tick of the cluster watch; a failure is logged. Until a poll succeeds, a removal
 * is late and dated at the start: the volume went while the server was down.
 */
function poller(db: Db, input: VolumeWatch): () => Promise<void> {
  const startedAt = input.now();
  let late = true;
  return async () => {
    const removedAt = late ? startedAt : input.now();
    try {
      await poll(db, { ...input, removedAt, late, now: input.now() });
      late = false;
    } catch (error) {
      logFailure(error, WATCH);
    }
  };
}

function storedEvents(db: Db): VolumeEvent[] {
  return eventsRepository
    .findByTypes(db, VOLUME_EVENT_NAMES)
    .map((row) => readVolumeEvent(row.body, `event ${row.id}`));
}

function up(db: Db): VolumeAdded[] {
  return volumesUp(storedEvents(db));
}

/** One price call for the new volumes of a poll; a failure is logged and the next poll asks again. */
async function addAll(input: NewVolumes): Promise<void> {
  const { db, volumes, api } = input;
  if (volumes.length === 0) return;
  const price = await priceLogged(api);
  if (price === null) return;
  for (const volume of volumes) addLogged(db, { volume, price });
}

async function priceLogged(api: HetznerApi): Promise<Price | null> {
  try {
    return await hetzner.volumePrice(api);
  } catch (error) {
    logFailure(error, WATCH);
    return null;
  }
}

/** One volume whose capacity is not a quantity is logged and tried again on the next poll. */
function addLogged(db: Db, input: NewVolume): void {
  try {
    store({ db, event: volumeAdded(input), at: input.volume.created });
  } catch (error) {
    logFailure(error, `${WATCH}: volume ${input.volume.name}`);
  }
}

/** A failed pod list is one stderr line and does not fail the poll; the next poll tries again. */
async function applyLogged(db: Db, rules: VolumeRules): Promise<void> {
  try {
    await applyRules(db, rules);
  } catch (error) {
    logFailure(error, WATCH);
  }
}

/**
 * Deletes each closed task's volume whose grace period is over and sends one notice for each idle
 * open one, unless a pod of its task is listed. Without an ntfy URL the notices are one stderr line.
 */
async function applyRules(db: Db, rules: VolumeRules): Promise<void> {
  const due = dueActions(db, rules);
  const deletions = due.filter((action) => action.action === "delete");
  const sends = noticeSends(due, rules);
  if (deletions.length + sends.length === 0) return;
  const pods = await kubernetes.jobPods(rules.kubernetes);
  const busy = new Set(pods.map((pod) => pod.task));
  const removals = deletions
    .filter((action) => !busy.has(action.volume.task))
    .map((action) => removeLogged(rules, action.volume));
  const notices = sends
    .filter((send) => !busy.has(send.notice.volume.task))
    .map((send) => notifyLogged(db, send));
  await Promise.all([...removals, ...notices]);
}

/** The notices to send; none without an ntfy URL, which is one stderr line when there are some. */
function noticeSends(due: VolumeAction[], rules: VolumeRules): NoticeSend[] {
  const notices = due.filter((action) => action.action === "notify");
  const url = rules.env.ntfy;
  if (url !== null) return notices.map((notice) => ({ notice, url, now: rules.now }));
  if (notices.length > 0) logNoNtfy(notices.length);
  return [];
}

/** The actions due for the listed volumes; none for a notice that was sent. */
function dueActions(db: Db, rules: VolumeRules): VolumeAction[] {
  return rules.listed.flatMap((volume) => {
    const action = volumeAction({
      volume,
      closedAt: newestClose(db, volume.task),
      runs: machineRuns.list(db, volume.task),
      now: rules.now,
      graceDays: rules.env.graceDays,
    });
    if (action === null) return [];
    if (action.action === "notify" && isSent(db, action)) return [];
    return [action];
  });
}

function newestClose(db: Db, task: string): string | null {
  return (
    eventsRepository.findBySubject(db, { type: CLOSE_OUTPUT, subject: task }).at(-1)?.at ?? null
  );
}

function isSent(db: Db, notice: VolumeNotice): boolean {
  return eventsRepository.findIds(db, [volumeIdleId(notice)]).length > 0;
}

function logNoNtfy(count: number): void {
  const volumesText = count === 1 ? "1 idle volume" : `${count} idle volumes`;
  console.error(`${WATCH}: ${volumesText}, no notice without TENBOX_SERVER_NTFY`);
}

/** A failed DELETE is one stderr line; the next poll tries again. */
async function removeLogged(rules: VolumeRules, volume: ListedVolume): Promise<void> {
  try {
    await kubernetes.removeVolume({ api: rules.kubernetes, name: volume.name });
  } catch (error) {
    logFailure(error, `${WATCH}: volume ${volume.name}`);
  }
}

/** A failed send stores nothing, so the next poll sends it again. */
async function notifyLogged(db: Db, send: NoticeSend): Promise<void> {
  try {
    await notify(db, send);
  } catch (error) {
    logFailure(error, `${WATCH}: volume ${send.notice.volume.name}`);
  }
}

async function notify(db: Db, send: NoticeSend): Promise<void> {
  const { notice, url, now } = send;
  const line = notificationLine({
    project: notice.project,
    id: taskId(notice.volume.task),
    state: NOTIFICATION_STATE.idleVolume,
    detail: `${notice.days} days`,
  });
  await ntfy.send({ url, line });
  events.saveFromServer(db, {
    id: volumeIdleId(notice),
    type: VOLUME_IDLE,
    subject: notice.volume.name,
    at: now.toISOString(),
    body: volumeIdle(notice),
  });
}

function store(input: StoredVolumeEvent): void {
  const { db, event, at } = input;
  events.saveFromServer(db, {
    id: volumeEventId(event),
    type: event.event,
    subject: event.volume,
    at,
    body: event,
  });
}

function logFailure(error: unknown, what: string): void {
  console.error(`${what}: ${errorMessage(error)}`);
}

/** Volumes: the task PVCs of the cluster, each stored as it came and went, with its size and price; a closed task's volume deleted after its grace period, an idle open one noticed. */
export const volumes = { poller, up };
