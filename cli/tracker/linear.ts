import { TenboxError } from "../domain/errors.ts";
import type { TrackerConfig } from "../domain/manifest.ts";
import type { TaskStatus, Tracker, TrackerTask } from "../ports.ts";

const ENDPOINT = "https://api.linear.app/graphql";

interface State {
  id: string;
  name: string;
  type: string;
  position: number;
}

interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string };
  team: { id: string; states: { nodes: State[] } };
}

const ISSUE_QUERY = `query($id: String!) { issue(id: $id) { id identifier title description url
  state { name type } team { id states { nodes { id name type position } } } } }`;

/** Linear over its GraphQL API. The key comes from `tracker.api_key` or `LINEAR_API_KEY`. */
export function linearTracker(config: TrackerConfig): Tracker {
  const apiKey = config.api_key ?? process.env.LINEAR_API_KEY;
  if (!apiKey) throw new TenboxError("Linear: set tracker.api_key in tenbox.local.yaml or LINEAR_API_KEY", "tracker-auth");

  async function query<T>(q: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey! },
      body: JSON.stringify({ query: q, variables }),
    });
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (!res.ok || body.errors?.length) {
      throw new TenboxError(`Linear: ${body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`}`, "tracker");
    }
    if (!body.data) throw new TenboxError("Linear: empty response", "tracker");
    return body.data;
  }

  async function issue(id: string): Promise<Issue> {
    const data = await query<{ issue: Issue | null }>(ISSUE_QUERY, { id });
    if (!data.issue) throw new TenboxError(`Linear: issue ${id} not found`, "tracker");
    return data.issue;
  }

  function pickState(states: State[], status: TaskStatus): State | undefined {
    const sorted = [...states].sort((a, b) => a.position - b.position);
    if (status === "done") return sorted.find((s) => s.type === "completed");
    return sorted.find((s) => s.type === "started");
  }

  return {
    kind: "linear",
    async getTask(id): Promise<TrackerTask> {
      const i = await issue(id);
      return { id: i.identifier, title: i.title, description: i.description ?? "", url: i.url, status: i.state.name };
    },
    async setStatus(id, status) {
      const i = await issue(id);
      const state = pickState(i.team.states.nodes, status);
      if (!state) throw new TenboxError(`Linear: no workflow state for ${status} in team ${i.team.id}`, "tracker");
      await query(`mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, { id: i.id, stateId: state.id });
    },
  };
}
