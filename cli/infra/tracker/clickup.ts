import { z } from "zod";
import { trackerAuthError, trackerError } from "../../../domain/errors/tools.ts";
import { type StatusNames, TRACKER_KIND, type TrackerConfig } from "../../../domain/manifest.ts";
import {
  type CommentRequest,
  type StatusChange,
  type TaskStatus,
  type Tracker,
  type TrackerTask,
} from "../../../domain/tracker.ts";
import { type Endpoint, http } from "../http.ts";

const DEFAULT_NAMES = { in_progress: "in progress", done: "done" } as const;

const API = "https://api.clickup.com/api/v2";

const TaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  markdown_description: z.string().nullable(),
  url: z.string(),
  status: z.object({ status: z.string() }),
  list: z.object({ id: z.string() }),
});

const ClickupStatusSchema = z.object({
  status: z.string(),
  type: z.string(),
  orderindex: z.number(),
});

const ListSchema = z.object({ statuses: z.array(ClickupStatusSchema) });

export type ClickupStatus = z.infer<typeof ClickupStatusSchema>;
type Task = z.infer<typeof TaskSchema>;

interface Connection {
  headers: Record<string, string>;
  names: StatusNames;
}

interface StatusChoice {
  statuses: ClickupStatus[];
  status: TaskStatus;
  names: StatusNames;
  listId: string;
}

/** ClickUp over REST API v2. The key comes from `tracker.api_key` or `CLICKUP_API_KEY`. */
export function clickupTracker(config: TrackerConfig): Tracker {
  const apiKey = config.api_key ?? process.env.CLICKUP_API_KEY;
  if (!apiKey) {
    const message = "ClickUp: set tracker.api_key in tenbox.local.yaml or CLICKUP_API_KEY";
    throw trackerAuthError(message);
  }
  const connection = { headers: { Authorization: apiKey }, names: config.statuses ?? {} };
  return {
    kind: TRACKER_KIND.clickup,
    getTask: (id) => getTask(connection, id),
    updateStatus: (id, status) => setStatus(connection, { id, status }),
    comment: (request) => addComment(connection, request),
  };
}

function endpoint(connection: Connection, path: string): Endpoint {
  return {
    service: "ClickUp",
    url: `${API}${path}`,
    headers: connection.headers,
    errorCode: "tracker",
  };
}

async function getTask(connection: Connection, id: string): Promise<TrackerTask> {
  const task = await fetchTask(connection, id);
  return toTrackerTask(task);
}

function fetchTask(connection: Connection, id: string): Promise<Task> {
  const path = `/task/${encodeURIComponent(id)}?include_markdown_description=true`;
  return http.get({ endpoint: endpoint(connection, path), schema: TaskSchema });
}

function toTrackerTask(task: Task): TrackerTask {
  return {
    id: task.id,
    title: task.name,
    description: task.markdown_description ?? "",
    url: task.url,
    status: task.status.status,
  };
}

async function setStatus(connection: Connection, change: StatusChange): Promise<string> {
  const task = await fetchTask(connection, change.id);
  const listId = task.list.id;
  const list = await http.get({
    endpoint: endpoint(connection, `/list/${encodeURIComponent(listId)}`),
    schema: ListSchema,
  });
  const status = pickStatus({
    statuses: list.statuses,
    status: change.status,
    names: connection.names,
    listId,
  });
  await http.put({
    endpoint: endpoint(connection, `/task/${encodeURIComponent(task.id)}`),
    body: { status },
    schema: z.unknown(),
  });
  return status;
}

async function addComment(connection: Connection, request: CommentRequest): Promise<void> {
  await http.post({
    endpoint: endpoint(connection, `/task/${encodeURIComponent(request.id)}/comment`),
    body: { comment_text: request.text },
    schema: z.unknown(),
  });
}

/** The list status to set: the configured name, else the one named "in progress" or "done". */
export function pickStatus(choice: StatusChoice): string {
  const sorted = [...choice.statuses].sort((a, b) => a.orderindex - b.orderindex);
  const name = choice.names[choice.status] ?? DEFAULT_NAMES[choice.status];
  const found = sorted.find((s) => s.status.toLowerCase() === name.toLowerCase());
  if (found) return found.status;
  const has = sorted.map((s) => s.status).join(", ");
  const setting = `{ ${choice.status}: "<status name>" }`;
  const message = `ClickUp: no status "${name}" in list ${choice.listId}; it has: ${has}`;
  throw trackerError(`${message}; set tracker.statuses, for example ${setting}`);
}
