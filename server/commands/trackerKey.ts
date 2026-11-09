import { parseArgs } from "node:util";
import { usageError } from "../../domain/errors/usage.ts";
import { type ProjectId, projectId } from "../../domain/ids.ts";
import { KEY_TRACKERS, type KeyTracker } from "../../domain/runTokens.ts";

export interface TrackerKeyArgs {
  project: ProjectId;
  tracker: KeyTracker;
}

export function readTrackerKeyArgs(argv: string[]): TrackerKeyArgs {
  const { values } = parseArgs({
    args: argv,
    options: { id: { type: "string" }, tracker: { type: "string" } },
    strict: true,
  });
  const tracker = KEY_TRACKERS.find((each) => each === values.tracker);
  if (!values.id || tracker === undefined) {
    throw usageError(`project tracker-key needs --id and --tracker ${KEY_TRACKERS.join("|")}`);
  }
  return { project: projectId(values.id), tracker };
}

export function readTrackerKey(stdin: string): string {
  const key = stdin.trim();
  if (key === "") throw usageError("project tracker-key reads the key on stdin");
  return key;
}
