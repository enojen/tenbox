const JOB_STATUS = { success: "success", failure: "failure" } as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
export type RunStatus = "in_progress" | "completed";
export type Outcome = "skipped" | null;

export interface Run {
  status: RunStatus;
  conclusion: JobStatus | null;
  note: "none" | null;
}

export type Short = Pick<Run, "status" | "conclusion">;
export type Rest = Omit<Run, "status" | "note">;
