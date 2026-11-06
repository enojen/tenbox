import {
  type ListedVolume,
  type NewVolume,
  type Price,
  readVolumeEvent,
  VOLUME_EVENT_NAMES,
  type VolumeEvent,
  volumeAdded,
  volumeChanges,
  volumeEventId,
  volumeRemoved,
} from "../../domain/events.ts";
import type { Db } from "../infra/db/index.ts";
import { type HetznerApi, hetzner } from "../infra/hetzner.ts";
import { type KubernetesApi, kubernetes } from "../infra/kubernetes.ts";
import { eventsRepository } from "../infra/repositories/events.ts";
import { events } from "./events.ts";
import { watches } from "./watches.ts";

const WATCH = "volume watch";

/** Where the volume watch reads the PVCs and the volume price. */
interface VolumeApis {
  kubernetes: KubernetesApi;
  hetzner: HetznerApi;
}

/** One poll: the time of a removal it finds, and whether the volume went while the server was down. */
interface VolumePoll extends VolumeApis {
  removedAt: Date;
  late: boolean;
}

interface VolumeWatch extends VolumeApis {
  now: () => Date;
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
      await poll(db, { ...input, removedAt, late });
      late = false;
    } catch (error) {
      watches.logFailure(error, WATCH);
    }
  };
}

function storedEvents(db: Db): VolumeEvent[] {
  return eventsRepository
    .findByTypes(db, VOLUME_EVENT_NAMES)
    .map((row) => readVolumeEvent(row.body, `event ${row.id}`));
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
    watches.logFailure(error, WATCH);
    return null;
  }
}

/** One volume whose capacity is not a quantity is logged and tried again on the next poll. */
function addLogged(db: Db, input: NewVolume): void {
  try {
    store({ db, event: volumeAdded(input), at: input.volume.created });
  } catch (error) {
    watches.logFailure(error, `${WATCH}: volume ${input.volume.name}`);
  }
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

/** Volumes: the task PVCs of the cluster, each stored as it came and went, with its size and price. */
export const volumes = { poll, poller };
