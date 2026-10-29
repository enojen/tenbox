import { tenboxDir } from "../../domain/taskDirs.ts";
import { newTaskOf, type TaskDraft, type TaskOrigin } from "../../domain/tracker.ts";
import { tasks } from "../application/tasks.ts";
import { env, log } from "../infra/env.ts";
import { git } from "../infra/git.ts";
import { githubIssues } from "../infra/tracker/github.ts";
import type { TaskNewResult } from "./results.ts";
import { draftOf, type TaskDraftInput } from "./task.ts";

/** The repositories a report may go to: `tenbox` for the CLI, roles and workflows, `tenyard` for the cluster. */
const REPORT_REPO = { tenbox: "enojen/tenbox", tenyard: "enojen/tenyard" } as const;

export type ReportRepo = keyof typeof REPORT_REPO;

export const REPORT_REPOS: ReportRepo[] = ["tenbox", "tenyard"];

export interface ReportInput extends TaskDraftInput {
  repo: ReportRepo;
}

/** A report is a bug unless its labels say otherwise. */
const DEFAULT_LABEL = "bug";

/** Enough of a commit sha to name a tenbox checkout. */
const SHORT_SHA = 7;

const UNKNOWN_COMMIT = "unknown";

/** Writes the draft to Tenbox's own issues, with where it was found and nothing else of the project. */
export async function report(input: ReportInput): Promise<TaskNewResult> {
  const draft = withDefaultLabel(draftOf(input));
  const origin = await findOrigin();
  const tracker = githubIssues(REPORT_REPO[input.repo]);
  const task = await tasks.ensure(tracker, newTaskOf(draft, origin));
  const verb = task.created ? "reported" : "exists already as";
  log(`${verb} ${REPORT_REPO[input.repo]}#${task.id} · ${task.url}`);
  return { ok: true, task: task.id, url: task.url, created: task.created };
}

/** `agent` is not a kind: a report with no other label is a bug. */
function withDefaultLabel(draft: TaskDraft): TaskDraft {
  const kinds = draft.labels.filter((label) => label !== "agent");
  if (kinds.length > 0) return draft;
  return { ...draft, labels: [DEFAULT_LABEL, ...draft.labels] };
}

/** The task of the worktree the command runs in, if any, and the commit of this tenbox. */
async function findOrigin(): Promise<TaskOrigin> {
  const head = await git.findHead(env().tenboxRoot);
  const tenbox = head === null ? UNKNOWN_COMMIT : head.slice(0, SHORT_SHA);
  const top = await git.findTopLevel(env().cwd);
  const task = await findTaskId(top);
  return { task, tenbox };
}

/** The id in `task.json` of the worktree; null outside a repository or a task worktree. */
async function findTaskId(worktree: string | null): Promise<string | null> {
  if (worktree === null) return null;
  const found = await tasks.find(tenboxDir(worktree));
  return found === null ? null : found.id;
}
