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
