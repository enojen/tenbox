import { z } from "zod";
import { trackerError } from "../../../domain/errors/tools.ts";
import { TRACKER_KIND } from "../../../domain/manifests.ts";
import {
  type CommentRequest,
  oldestFirst,
  type StatusChange,
  TASK_STATUS,
  type Tracker,
  type TrackerComment,
  type TrackerTask,
} from "../../../domain/tracker.ts";
import { jsons } from "../../../domain/utils.ts";
import { processes } from "../processes.ts";

const ISSUE_STATE = { open: "OPEN", closed: "CLOSED" } as const;

/** The output of `gh issue view <n> --json number,title,body,url,state`. */
const IssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  state: z.enum(ISSUE_STATE),
});

/** The output of `gh issue view <n> --json comments`. */
const CommentsSchema = z.object({
  comments: z.array(
    z.object({
      author: z.object({ login: z.string() }),
      body: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

type Issue = z.infer<typeof IssueSchema>;

/**
 * GitHub Issues of the repository of the current directory, through `gh`. The task id is the
 * issue number. In progress leaves the issue open; done closes it.
 */
export const githubTracker: Tracker = {
  kind: TRACKER_KIND.github,
  getTask: fetchTask,
  updateStatus: (id, status) => updateIssueStatus({ id, status }),
  comment: commentOnIssue,
  comments: fetchComments,
};

async function fetchTask(id: string): Promise<TrackerTask> {
  const issue = await fetchIssue(id);
  return {
    id: String(issue.number),
    title: issue.title,
    description: issue.body,
    url: issue.url,
    status: issue.state,
  };
}

async function fetchIssue(id: string): Promise<Issue> {
  const stdout = await run(["issue", "view", id, "--json", "number,title,body,url,state"]);
  return checkOutput(IssueSchema, stdout);
}

async function updateIssueStatus(change: StatusChange): Promise<string> {
  const issue = await fetchIssue(change.id);
  if (change.status !== TASK_STATUS.done || issue.state === ISSUE_STATE.closed) {
    return issue.state;
  }
  await run(["issue", "close", change.id]);
  return ISSUE_STATE.closed;
}

async function commentOnIssue(comment: CommentRequest): Promise<void> {
  await run(["issue", "comment", comment.id, "--body", comment.text]);
}

async function fetchComments(id: string): Promise<TrackerComment[]> {
  const stdout = await run(["issue", "view", id, "--json", "comments"]);
  const data = checkOutput(CommentsSchema, stdout);
  return oldestFirst(
    data.comments.map((c) => ({ author: c.author.login, date: c.createdAt, body: c.body })),
  );
}

function checkOutput<T>(schema: z.ZodType<T>, stdout: string): T {
  const result = jsons.check(schema, stdout);
  if (result.ok) return result.value;
  throw trackerError(`GitHub: gh output does not fit: ${result.issues.join("; ")}`);
}

/** `gh issue ...` in the current directory, so `gh` finds the repository itself. */
async function run(args: string[]): Promise<string> {
  const result = await processes.run(["gh", ...args]);
  if (result.code === 0) return result.stdout.trim();
  const reason = result.stderr.trim() || result.stdout.trim();
  throw trackerError(`GitHub: gh ${args.slice(0, 2).join(" ")}: ${reason}`);
}
