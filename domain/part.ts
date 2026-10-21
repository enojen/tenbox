const PART_ID = /^[^-.]+/;

/** The `NN` of a part name `NN-<slug>` or a part file name `NN-<slug>.md`. */
export function partIdOf(fileName: string): string {
  return PART_ID.exec(fileName)?.[0] ?? fileName;
}

const PART_STATUSES = ["todo", "doing", "done", "blocked"] as const;

export type PartStatus = (typeof PART_STATUSES)[number];

/** How many parts have each status. */
export type PartCounts = Record<PartStatus, number>;

const STATUS_LINE = /^status:\s*(\S+)/m;

/** The `status:` line of a part file; `todo` when it is missing or not one of the four. */
export function readPartStatus(text: string): PartStatus {
  const word = STATUS_LINE.exec(text)?.[1];
  return PART_STATUSES.find((status) => status === word) ?? "todo";
}

export function countParts(statuses: PartStatus[]): PartCounts {
  const counts: PartCounts = { todo: 0, doing: 0, done: 0, blocked: 0 };
  for (const status of statuses) counts[status] += 1;
  return counts;
}
