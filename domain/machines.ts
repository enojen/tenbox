/** The resource classes of tenyard `task/classes.yaml` that a machine run takes. */
export const RESOURCE_CLASS = { plan: "plan", build: "build", heavy: "heavy" } as const;

export type ResourceClass = (typeof RESOURCE_CLASS)[keyof typeof RESOURCE_CLASS];

/** The phase of a Tenport run, as Kubernetes names the phase of a pod. */
export const RUN_PHASE = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  unknown: "Unknown",
} as const;

export type RunPhase = (typeof RUN_PHASE)[keyof typeof RUN_PHASE];

/**
 * The reasons of a box container that waits and never starts by itself: a log that follows such a
 * run stops and names the reason instead of asking again.
 */
const LASTING_BOX_REASONS = [
  "CreateContainerConfigError",
  "CreateContainerError",
  "ErrImagePull",
  "ImagePullBackOff",
  "InvalidImageName",
];

/** The reason at the end of Tenport's `box-not-started` detail, `...has not started: <reason>`. */
export function lastingBoxReason(detail: string): string | null {
  return LASTING_BOX_REASONS.find((reason) => detail.endsWith(`: ${reason}`)) ?? null;
}

/**
 * The exit code of a box whose task archive download or upload failed after every retry:
 * `EX_TEMPFAIL` of sysexits.h, as the command did not fail and a later run can pass.
 */
export const ARCHIVE_FAILED_EXIT_CODE = 75;

/** The reason of a box container that ended by the kernel's memory limit. */
export const OOM_KILLED = "OOMKilled";

/** The last line of the boot log says a process of the box was OOM-killed: `oom_kill <n>`, n > 0. */
export function oomKilledInLog(text: string): boolean {
  const last = text.trimEnd().split("\n").pop() ?? "";
  const count = /oom_kill (\d+)\s*$/.exec(last)?.[1];
  return count !== undefined && Number(count) > 0;
}

export interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
}

export interface GitAuthor {
  name: string;
  email: string;
}

export function gitAuthor(user: GitHubUser): GitAuthor {
  const { login, id, name } = user;
  return { name: name ?? login, email: `${id}+${login}@users.noreply.github.com` };
}
