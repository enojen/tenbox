import {
  type ListedNode,
  NODE_EVENT_NAMES,
  type NodeEvent,
  nodeAdded,
  nodeChanges,
  nodeEventId,
  nodeRemoved,
  readNodeEvent,
} from "../../domain/events.ts";
import type { Db } from "../infra/db/index.ts";
import { type HetznerApi, hetzner } from "../infra/hetzner.ts";
import { type ClusterNode, type KubernetesApi, kubernetes } from "../infra/kubernetes.ts";
import { eventsRepository } from "../infra/repositories/events.ts";
import { events } from "./events.ts";
import { machineRuns } from "./machineRuns.ts";
import { volumes } from "./volumes.ts";
import { watches } from "./watches.ts";

const POLL_INTERVAL_MS = 30_000;

/** Where the node watch reads the Nodes and their servers. */
interface NodeApis {
  kubernetes: KubernetesApi;
  hetzner: HetznerApi;
}

/** One poll: the time of a removal it finds, and whether the node left while the server was down. */
interface NodePoll extends NodeApis {
  removedAt: Date;
  late: boolean;
}

interface NodeWatch extends NodeApis {
  now: () => Date;
}

/** A running watch; `stop` waits for the poll in progress. */
export interface Watching {
  stop: () => Promise<void>;
}

/** One node event and the time it happened. */
interface NodeEventAt {
  event: NodeEvent;
  at: string;
}

/** One new node to price and store. */
interface NewNode {
  db: Db;
  node: ListedNode;
  api: HetznerApi;
}

/** Stores a `node.added` for each new Hetzner server among the Nodes and a `node.removed` for each one gone. */
async function poll(db: Db, input: NodePoll): Promise<void> {
  const listed = await kubernetes.nodes(input.kubernetes);
  const changes = nodeChanges({ stored: storedEvents(db), listed: listed.flatMap(listedNode) });
  const removedAt = input.removedAt.toISOString();
  for (const added of changes.removed) {
    store(db, { event: nodeRemoved({ added, late: input.late }), at: removedAt });
  }
  await Promise.all(changes.added.map((node) => addLogged({ db, node, api: input.hetzner })));
}

/**
 * Polls the Nodes, the Job pods and the task volumes now and every 30 seconds; a poll that fails
 * is logged and the next one tries again, and one poll does not stop the others. Until a node poll succeeds, a
 * removal is late and dated at the start: the node left while the server was down.
 */
function watch(db: Db, input: NodeWatch): Watching {
  const startedAt = input.now();
  let late = true;
  let running: Promise<unknown> | null = null;
  const pollJobs = machineRuns.poller(db, input);
  const pollVolumes = volumes.poller(db, input);
  const tick = () => {
    if (running !== null) return;
    const removedAt = late ? startedAt : input.now();
    const pollNodes = poll(db, { ...input, removedAt, late }).then(() => {
      late = false;
    }, logWatchFailure);
    running = Promise.all([pollNodes, pollJobs(), pollVolumes()]).finally(() => {
      running = null;
    });
  };
  tick();
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  return {
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}

function listedNode(node: ClusterNode): ListedNode[] {
  const serverId = node.providerId === null ? null : hetzner.serverId(node.providerId);
  return serverId === null ? [] : [{ name: node.name, serverId }];
}

function storedEvents(db: Db): NodeEvent[] {
  return eventsRepository
    .findByTypes(db, NODE_EVENT_NAMES)
    .map((row) => readNodeEvent(row.body, `event ${row.id}`));
}

/** One node whose server Hetzner cannot give is logged and asked again on the next poll. */
async function addLogged(input: NewNode): Promise<void> {
  try {
    await add(input);
  } catch (error) {
    watches.logFailure(error, `node ${input.node.name}`);
  }
}

async function add(input: NewNode): Promise<void> {
  const { db, node, api } = input;
  const server = await hetzner.server({ api, id: node.serverId });
  const event = nodeAdded({
    node: node.name,
    server_id: node.serverId,
    server_type: server.type,
    location: server.location,
    price_hourly: server.priceHourly,
  });
  store(db, { event, at: server.createdAt });
}

function store(db: Db, input: NodeEventAt): void {
  const { event, at } = input;
  events.saveFromServer(db, {
    id: nodeEventId(event),
    type: event.event,
    subject: event.node,
    at,
    body: event,
  });
}

function logWatchFailure(error: unknown): void {
  watches.logFailure(error, "node watch");
}

/** Nodes: the workers of the cluster, each stored as it came and went, with its server type and price. */
export const nodes = { poll, watch };
