import { TRACKER_KIND } from "../../../domain/manifests.ts";
import {
  type CommentRequest,
  labelsIntoBody,
  type NewTask,
  oldestFirst,
  type StatusChange,
  TASK_STATUS,
  type TaskRef,
  type Tracker,
  type TrackerComment,
  type TrackerTask,
} from "../../../domain/tracker.ts";
import { gh, ISSUE_STATE, type IssueTarget } from "../gh.ts";

/**
 * GitHub Issues of the repository of the current directory, through `gh`. The task id is the
 * issue number. In progress leaves the issue open; done closes it.
 */
export const githubTracker: Tracker = githubIssues(null);

/** The issues of `repo` (`owner/name`), or of the repository of the current directory. */
export function githubIssues(repo: string | null): Tracker {
  const target = (): IssueTarget => ({ dir: process.cwd(), repo });
  return {
    kind: TRACKER_KIND.github,
    getTask: (id) => fetchTask(target(), id),
    updateStatus: (id, status) => updateIssueStatus(target(), { id, status }),
    comment: (request) => commentOnIssue(target(), request),
    comments: (id) => fetchComments(target(), id),
    findOpen: (title) => findOpenIssue(target(), title),
    create: (task) => createIssue(target(), task),
  };
}

async function fetchTask(target: IssueTarget, id: string): Promise<TrackerTask> {
  const issue = await gh.viewIssue(target, id);
  return {
    id: String(issue.number),
    title: issue.title,
    description: issue.body,
    url: issue.url,
    status: issue.state,
  };
}

async function updateIssueStatus(target: IssueTarget, change: StatusChange): Promise<string> {
  const issue = await gh.viewIssue(target, change.id);
  if (change.status !== TASK_STATUS.done || issue.state === ISSUE_STATE.closed) {
    return issue.state;
  }
  await gh.closeIssue(target, change.id);
  return ISSUE_STATE.closed;
}

async function commentOnIssue(target: IssueTarget, comment: CommentRequest): Promise<void> {
  await gh.commentIssue(target, comment.id, comment.text);
}

async function fetchComments(target: IssueTarget, id: string): Promise<TrackerComment[]> {
  const comments = await gh.issueComments(target, id);
  return oldestFirst(
    comments.map((c) => ({ author: c.author.login, date: c.createdAt, body: c.body })),
  );
}

/** GitHub's search finds the words; the issue with exactly this title, ignoring case, is ours. */
async function findOpenIssue(target: IssueTarget, title: string): Promise<TaskRef | null> {
  const wanted = title.trim().toLowerCase();
  const issues = await gh.listOpenIssues(target, title);
  const found = issues.find((issue) => issue.title.trim().toLowerCase() === wanted);
  return found === undefined ? null : { id: String(found.number), url: found.url };
}

/**
 * A label the repository lacks is created first: `gh issue create` refuses an unknown one. A
 * login without push access may set none, so its labels go into the body for a person to set.
 */
async function createIssue(target: IssueTarget, task: NewTask): Promise<TaskRef> {
  const allowed = await gh.canLabel(target);
  if (allowed) await ensureLabels(target, task.labels);
  const issue = await gh.createIssue(target, allowed ? task : labelsIntoBody(task));
  return { id: String(issue.number), url: issue.url };
}

async function ensureLabels(target: IssueTarget, labels: string[]): Promise<void> {
  const known = await gh.listLabels(target);
  for (const label of labels) {
    if (!known.includes(label)) await gh.createLabel(target, label);
  }
}
