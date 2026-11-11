import { BUILD_STATUS, type BuildResult, type Finding } from "./builds.ts";
import type { DecisionCard } from "./cards.ts";
import type { PartCounts, PartStatus } from "./parts.ts";

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
  /** Why a `failed` or `needs-you` build stopped; null for any other status. */
  reason: ReportReason | null;
}

/** A part file that does not say `status: done`, with its `result:` line. */
export interface ReportPart {
  part: string;
  status: PartStatus;
  result: string | null;
}

/** What `build.json` and the part files say about a build that stopped. */
export interface ReportReason {
  feedback: string | null;
  attention: string[];
  findings: Finding[];
  decision: DecisionCard | null;
  parts: ReportPart[];
}

export interface ReasonInput {
  status: string | null;
  build: BuildResult | null;
  parts: ReportPart[];
}

const STOPPED: readonly string[] = [BUILD_STATUS.failed, BUILD_STATUS.needsYou];

/** The reason of a task whose status is `failed` or `needs-you` and that has a `build.json`. */
export function stopReason(input: ReasonInput): ReportReason | null {
  const { status, build, parts } = input;
  if (build === null || status === null || !STOPPED.includes(status)) return null;
  const { feedback, attention, findings, decision } = build;
  return { feedback: feedback ?? null, attention, findings, decision: decision ?? null, parts };
}

/** A task whose status report failed in `tenbox list`: the error as a failed command prints it. */
interface FailedReport {
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
