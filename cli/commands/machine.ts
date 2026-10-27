import { usageError } from "../../domain/errors/usage.ts";
import type { TaskId } from "../../domain/ids.ts";
import { machines } from "../application/machines.ts";
import type { MachineLogsResultJson, MachineLsResult, MachineRunResultJson } from "./results.ts";

export interface MachineRunArgs {
  id: TaskId;
  /** The words after `--`. */
  words: string[];
  usage: string;
}

/** Starts one tenbox command of the task as a Job on the cluster. */
export async function runOnMachine(args: MachineRunArgs): Promise<MachineRunResultJson> {
  if (args.words.length === 0) throw usageError(`usage: ${args.usage}`);
  const { task, cmd, url } = await machines.run({ id: args.id, words: args.words });
  return { ok: true, task, cmd, url };
}

export async function listMachineRuns(): Promise<MachineLsResult> {
  const runs = await machines.list();
  return { ok: true, runs };
}

export interface MachineLogsArgs {
  id: TaskId;
  follow: boolean;
}

/** Writes the pod log of the task's newest Job to stderr. */
export async function showMachineLogs(args: MachineLogsArgs): Promise<MachineLogsResultJson> {
  const { task, job, status } = await machines.logs({
    id: args.id,
    follow: args.follow,
    write: (chunk) => process.stderr.write(chunk),
  });
  return { ok: true, task, job, status };
}
