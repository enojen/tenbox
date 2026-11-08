/** The resource classes of tenyard `task/classes.yaml` that a machine run takes. */
export const RESOURCE_CLASS = { plan: "plan", build: "build", heavy: "heavy" } as const;

export type ResourceClass = (typeof RESOURCE_CLASS)[keyof typeof RESOURCE_CLASS];

/** How the Job of a machine run ended, or that it still runs. */
export const JOB_STATUS = {
  inProgress: "in_progress",
  success: "success",
  failure: "failure",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/** The `status` of a row of `tenbox machine ls`, named as GitHub Actions names a run. */
export const RUN_STATUS = { inProgress: "in_progress", completed: "completed" } as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

/** How a completed run ended. */
export type RunConclusion = typeof JOB_STATUS.success | typeof JOB_STATUS.failure;

/** What `tenbox machine rm` did to the task volume. */
export const VOLUME_STATE = { deleted: "deleted", missing: "missing" } as const;

export type VolumeState = (typeof VOLUME_STATE)[keyof typeof VOLUME_STATE];

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
