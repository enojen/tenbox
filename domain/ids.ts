import { TenboxError } from "./errors.ts";
import type { Names } from "./manifest.ts";

/** A tracker task id such as `TEN-301` or `86abc123`. Validated once, at the edge. */
export type TaskId = string & { readonly __brand: "TaskId" };

/** Letters, digits, `_` and `-`: safe in a git ref, a tmux session name and a path. */
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isSafeName(raw: string): boolean {
  return SAFE_NAME_PATTERN.test(raw);
}

export function taskId(raw: string): TaskId {
  if (!isSafeName(raw)) {
    throw new TenboxError(`task id "${raw}": letters, digits, _ and - only`, "usage");
  }
  return raw as TaskId;
}

/** A project's id in `tenbox.yaml`: 6 characters, a-z and 0-9, e.g. `k7f3qa`. */
export type ProjectId = string & { readonly __brand: "ProjectId" };

const PROJECT_ID_LENGTH = 6;
const PROJECT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const PROJECT_ID_PATTERN = new RegExp(`^[${PROJECT_ID_ALPHABET}]{${PROJECT_ID_LENGTH}}$`);

export function isProjectId(raw: string): boolean {
  return PROJECT_ID_PATTERN.test(raw);
}

export function projectId(raw: string): ProjectId {
  if (!isProjectId(raw)) {
    throw new TenboxError(`project id "${raw}": 6 characters, a-z and 0-9`, "usage");
  }
  return raw as ProjectId;
}

/** A random project id; `tenbox start` writes it once into `tenbox.yaml`. */
export function newProjectId(): ProjectId {
  const random = crypto.getRandomValues(new Uint8Array(PROJECT_ID_LENGTH));
  const chars = Array.from(random, (n) => PROJECT_ID_ALPHABET[n % PROJECT_ID_ALPHABET.length]);
  return projectId(chars.join(""));
}

const SHORT_SHA_LENGTH = 7;

export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

/**
 * Every name derived from a task is built here. The templates come from `names:` in
 * `tenbox.yaml`; `taskId()` and `NamesSchema` together keep the results safe.
 */
export function taskBranch(names: Names, id: TaskId): string {
  return fillName(names.branch, id);
}

export function tmuxSessionName(names: Names, id: TaskId): string {
  return fillName(names.tmux, id);
}

function fillName(template: string, id: TaskId): string {
  return template.replace("{id}", id);
}
