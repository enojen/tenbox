import {
  AGENT_LABEL,
  newTaskOf,
  parseTaskDraft,
  type TaskDraft,
  type Tracker,
  taskDraftOf,
} from "../../domain/tracker.ts";
import { manifests } from "../application/manifests.ts";
import { projects } from "../application/projects.ts";
import { tasks } from "../application/tasks.ts";
import { env, log } from "../infra/env.ts";
import { git } from "../infra/git.ts";
import { makeTracker } from "../infra/tracker/index.ts";
import type { TaskNewResult } from "./results.ts";

/** The draft of a task: `--json` as one object, or one flag per section. */
export interface TaskDraftInput {
  json: string | undefined;
  title: string | undefined;
  why: string | undefined;
  what: string | undefined;
  done: string | undefined;
  labels: string[];
}

/** Writes the draft to the project's tracker, or returns the open task that has its title already. */
export async function newTask(input: TaskDraftInput): Promise<TaskNewResult> {
  const tracker = await trackerHere(env().cwd);
  const task = await tasks.ensure(tracker, newTaskOf(draftOf(input)));
  const verb = task.created ? "opened" : "exists already as";
  log(`${verb} ${task.id} · ${task.url}`);
  return { ok: true, task: task.id, url: task.url, created: task.created };
}

/** The draft from `--json` or the flags; inside a Claude Code session it gets the `agent` label. */
export function draftOf(input: TaskDraftInput): TaskDraft {
  const draft = input.json === undefined ? taskDraftOf(flagsOf(input)) : parseTaskDraft(input.json);
  if (!env().agent || draft.labels.includes(AGENT_LABEL)) return draft;
  return { ...draft, labels: [...draft.labels, AGENT_LABEL] };
}

/** The tracker of the checkout the command runs in: a task worktree's own `tenbox.yaml` wins, as for `tenbox check`. */
async function trackerHere(cwd: string): Promise<Tracker> {
  const { project } = await projects.get(cwd);
  const checkout = await git.findTopLevel(cwd);
  const manifest = await manifests.get(project.mainDir, checkout ?? project.mainDir);
  return makeTracker(manifest.tracker);
}

function flagsOf(input: TaskDraftInput): Record<string, unknown> {
  const { title, why, what, done, labels } = input;
  return { title, why, what, done, labels };
}
