import type { TaskId } from "../../domain/ids.ts";
import { statusReports } from "../application/statusReports.ts";
import type { StatusResult } from "./results.ts";

/** Where one task stands: phase, round, parts, session, PR and the last check result. */
export async function showStatus(id: TaskId): Promise<StatusResult> {
  const report = await statusReports.get(id);
  return { ok: true, ...report };
}
