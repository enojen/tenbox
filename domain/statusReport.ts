import type { PartCounts } from "./part.ts";

/** The open PR of the task branch. */
export interface ReportPr {
  number: number;
  url: string;
  draft: boolean;
}

/** The newest round that has a `checks.json`, with what it says. */
export interface ReportChecks {
  round: number;
  ok: boolean | null;
  summary: string | null;
}

/** The state of one task, read from its files, its background session and its PR. */
export interface StatusReport {
  task: string;
  title: string | null;
  /** The `status` of `task.json`; null without the file. */
  status: string | null;
  /** The newest round directory, else the round of `build.json`; null with neither. */
  round: number | null;
  approved: boolean;
  parts: PartCounts;
  session: { state: string };
  pr: ReportPr | null;
  checks: ReportChecks | null;
}

/** One line for `tenbox list` on stderr. */
export function reportLine(report: StatusReport): string {
  const { task, status, round, parts, session, pr } = report;
  const total = parts.todo + parts.doing + parts.done + parts.blocked;
  return [
    task,
    status ?? "-",
    `round ${round ?? "-"}`,
    `parts ${parts.done}/${total}`,
    `session ${session.state}`,
    `PR ${pr === null ? "-" : `#${pr.number}`}`,
  ].join(" · ");
}
