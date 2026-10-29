const JOB_STATUS = { success: "success", failure: "failure" } as const;
const PART_STATUSES = ["todo", "done"] as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
export type PartStatus = (typeof PART_STATUSES)[number];

interface Item {
  id: string;
}

export interface Result {
  status: JobStatus;
  items: Item[];
}

export function first(result: Result): Item | undefined {
  return result.items[0];
}
