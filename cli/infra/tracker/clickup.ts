import { z } from "zod";
import { trackerAuthError, trackerError } from "../../../domain/errors/tools.ts";
import { type StatusNames, TRACKER_KIND, type TrackerConfig } from "../../../domain/manifests.ts";
import {
  type CommentRequest,
  type NewTask,
  oldestFirst,
  type StatusChange,
  type TaskRef,
  type TaskStatus,
  type Tracker,
  type TrackerComment,
  type TrackerTask,
} from "../../../domain/tracker.ts";
import { type Endpoint, http } from "../http.ts";
import { findApiKey } from "./apiKeys.ts";

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

const CommentListSchema = z.object({
  comments: z.array(
    z.object({
      comment_text: z.string(),
      user: z.object({ username: z.string() }),
      date: z.string(),
    }),
  ),
});

const ClickupStatusSchema = z.object({
  status: z.string(),
  type: z.string(),
  orderindex: z.number(),
});

const ListSchema = z.object({ statuses: z.array(ClickupStatusSchema) });

const TaskRefSchema = z.object({ id: z.string(), url: z.string() });

/** The output of `GET /list/{id}/task`: the open tasks of the list. */
const ListTasksSchema = z.object({ tasks: z.array(TaskRefSchema.extend({ name: z.string() })) });

export type ClickupStatus = z.infer<typeof ClickupStatusSchema>;
type Task = z.infer<typeof TaskSchema>;

interface Connection {
  headers: Record<string, string>;
  names: StatusNames;
  /** `tracker.list`: the list a new task goes to; undefined until a project sets it. */
  list: string | undefined;
}

interface StatusChoice {
  statuses: ClickupStatus[];
  status: TaskStatus;
  names: StatusNames;
  listId: string;
}

/** ClickUp over REST API v2. The key comes from `tracker.api_key` or `CLICKUP_API_KEY`. */
export function clickupTracker(config: TrackerConfig): Tracker {
  const apiKey = findApiKey(config);
  if (!apiKey) {
    const message = "ClickUp: set tracker.api_key in tenbox.local.yaml or CLICKUP_API_KEY";
    throw trackerAuthError(message);
  }
  const connection = {
    headers: { Authorization: apiKey },
    names: config.statuses ?? {},
    list: config.list,
  };
  return {
    kind: TRACKER_KIND.clickup,
    getTask: (id) => getTask(connection, id),
    updateStatus: (id, status) => setStatus(connection, { id, status }),
    comment: (request) => addComment(connection, request),
    comments: (id) => getComments(connection, id),
    findOpen: (title) => findOpenTask(connection, title),
    create: (task) => createTask(connection, task),
  };
}

/** The list of a new task, from `tracker.list`; without it, nothing can be written. */
function listPath(connection: Connection): string {
  if (!connection.list) {
    throw trackerError("ClickUp: set tracker.list to the id of the list, for example 901234567");
  }
  return `/list/${encodeURIComponent(connection.list)}/task`;
}

async function findOpenTask(connection: Connection, title: string): Promise<TaskRef | null> {
  const wanted = title.trim().toLowerCase();
  const list = await http.get({
    endpoint: endpoint(connection, listPath(connection)),
    schema: ListTasksSchema,
  });
  const found = list.tasks.find((task) => task.name.trim().toLowerCase() === wanted);
  return found === undefined ? null : { id: found.id, url: found.url };
}

/** ClickUp makes a tag on first use, so the labels need no step of their own. */
async function createTask(connection: Connection, task: NewTask): Promise<TaskRef> {
  return await http.post({
    endpoint: endpoint(connection, listPath(connection)),
    body: { name: task.title, markdown_description: task.body, tags: task.labels },
    schema: TaskRefSchema,
  });
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

async function getComments(connection: Connection, id: string): Promise<TrackerComment[]> {
  const path = `/task/${encodeURIComponent(id)}/comment`;
  const list = await http.get({ endpoint: endpoint(connection, path), schema: CommentListSchema });
  return oldestFirst(
    list.comments.map((c) => ({
      author: c.user.username,
      date: new Date(Number(c.date)).toISOString(),
      body: c.comment_text,
    })),
  );
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
