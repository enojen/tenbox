import type { PartCounts } from "./parts.ts";

/** The open PR of the task branch. */
export interface ReportPr {
  number: number;
  url: string;
  draft: boolean;
}

/** The newest round that has a `checks.json`, with what it says. */
export interface ReportChecks {
  round: number;
  ok: boolean;
  summary: string;
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

/** A task whose status report failed in `tenbox list`: the error as a failed command prints it. */
export interface FailedReport {
  task: string;
  error: string;
  code: string;
}

/** One task of `tenbox list`. */
export type ListedReport = StatusReport | FailedReport;

/** One line for `tenbox list` on stderr. */
export function reportLine(report: ListedReport): string {
  if ("error" in report) return [report.task, report.code, report.error].join(" · ");
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
