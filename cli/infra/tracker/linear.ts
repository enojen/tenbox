import { z } from "zod";
import { trackerAuthError, trackerError } from "../../../domain/errors/tools.ts";
import type { TrackerConfig } from "../../../domain/manifest.ts";
import type {
  CommentRequest,
  StatusChange,
  TaskStatus,
  Tracker,
  TrackerTask,
} from "../../../domain/tracker.ts";
import { graphqlQuery } from "../graphql.ts";
import type { Endpoint } from "../http.ts";

const ENDPOINT = "https://api.linear.app/graphql";

const StateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  position: z.number(),
});

const IssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  state: z.object({ name: z.string(), type: z.string() }),
  team: z.object({ id: z.string(), states: z.object({ nodes: z.array(StateSchema) }) }),
});

const IssueDataSchema = z.object({ issue: IssueSchema.nullable() });

type State = z.infer<typeof StateSchema>;
type Issue = z.infer<typeof IssueSchema>;

const ISSUE_QUERY = `
  query($id: String!) {
    issue(id: $id) {
      id identifier title description url
      state { name type }
      team { id states { nodes { id name type position } } }
    }
  }`;

const STATUS_MUTATION = `
  mutation($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) { success }
  }`;

const COMMENT_MUTATION = `
  mutation($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) { success }
  }`;

/** Linear over its GraphQL API. The key comes from `tracker.api_key` or `LINEAR_API_KEY`. */
export function linearTracker(config: TrackerConfig): Tracker {
  const endpoint = linearEndpoint(config);
  return {
    kind: "linear",
    getTask: (id) => fetchTask(endpoint, id),
    updateStatus: (id, status) => updateIssueStatus(endpoint, { id, status }),
    comment: (request) => commentOnIssue(endpoint, request),
  };
}

function linearEndpoint(config: TrackerConfig): Endpoint {
  const apiKey = config.api_key ?? process.env.LINEAR_API_KEY;
  if (!apiKey) {
    const message = "Linear: set tracker.api_key in tenbox.local.yaml or LINEAR_API_KEY";
    throw trackerAuthError(message);
  }
  return {
    service: "Linear",
    url: ENDPOINT,
    headers: { Authorization: apiKey },
    errorCode: "tracker",
  };
}

async function fetchTask(endpoint: Endpoint, id: string): Promise<TrackerTask> {
  const issue = await fetchIssue(endpoint, id);
  return toTrackerTask(issue);
}

async function fetchIssue(endpoint: Endpoint, id: string): Promise<Issue> {
  const data = await graphqlQuery({
    endpoint,
    query: ISSUE_QUERY,
    variables: { id },
    data: IssueDataSchema,
  });
  if (!data.issue) throw trackerError(`Linear: issue ${id} not found`);
  return data.issue;
}

function toTrackerTask(issue: Issue): TrackerTask {
  return {
    id: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    url: issue.url,
    status: issue.state.name,
  };
}

async function updateIssueStatus(endpoint: Endpoint, change: StatusChange): Promise<void> {
  const issue = await fetchIssue(endpoint, change.id);
  const state = pickState(issue.team.states.nodes, change.status);
  if (!state) {
    const message = `Linear: no workflow state for ${change.status} in team ${issue.team.id}`;
    throw trackerError(message);
  }
  await graphqlQuery({
    endpoint,
    query: STATUS_MUTATION,
    variables: { id: issue.id, stateId: state.id },
    data: z.unknown(),
  });
}

async function commentOnIssue(endpoint: Endpoint, comment: CommentRequest): Promise<void> {
  const issue = await fetchIssue(endpoint, comment.id);
  await graphqlQuery({
    endpoint,
    query: COMMENT_MUTATION,
    variables: { issueId: issue.id, body: comment.text },
    data: z.unknown(),
  });
}

function pickState(states: State[], status: TaskStatus): State | undefined {
  const wantedType = status === "done" ? "completed" : "started";
  return [...states]
    .sort((a, b) => a.position - b.position)
    .find((state) => state.type === wantedType);
}
