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
import { gh, ISSUE_STATE } from "../gh.ts";

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
  const issue = await gh.viewIssue(process.cwd(), id);
  return {
    id: String(issue.number),
    title: issue.title,
    description: issue.body,
    url: issue.url,
    status: issue.state,
  };
}

async function updateIssueStatus(change: StatusChange): Promise<string> {
  const issue = await gh.viewIssue(process.cwd(), change.id);
  if (change.status !== TASK_STATUS.done || issue.state === ISSUE_STATE.closed) {
    return issue.state;
  }
  await gh.closeIssue(process.cwd(), change.id);
  return ISSUE_STATE.closed;
}

async function commentOnIssue(comment: CommentRequest): Promise<void> {
  await gh.commentIssue(process.cwd(), comment.id, comment.text);
}

async function fetchComments(id: string): Promise<TrackerComment[]> {
  const comments = await gh.issueComments(process.cwd(), id);
  return oldestFirst(
    comments.map((c) => ({ author: c.author.login, date: c.createdAt, body: c.body })),
  );
}
