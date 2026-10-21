import { reportLine } from "../../domain/statusReport.ts";
import { statusReports } from "../application/statusReports.ts";
import { log } from "../infra/env.ts";
import type { ListResult } from "./results.ts";

/** The status report of every open task of the project; one line each on stderr. */
export async function listTasks(): Promise<ListResult> {
  const reports = await statusReports.list();
  for (const report of reports) log(reportLine(report));
  return { ok: true, tasks: reports };
}
