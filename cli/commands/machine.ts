import { usageError } from "../../domain/errors/usage.ts";
import type { TaskId } from "../../domain/ids.ts";
import { durations } from "../../domain/utils.ts";
import { machines } from "../application/machines.ts";
import type {
  MachineLogsResultJson,
  MachineLsResult,
  MachineRmResult,
  MachineRunResultJson,
  MachineStopResult,
  MachineWaitResultJson,
} from "./results.ts";

export interface MachineRunArgs {
  id: TaskId;
  /** The words after `--`. */
  words: string[];
  usage: string;
  /** `--timeout` of `--wait`, in seconds; null without `--wait`. */
  waitSeconds: number | null;
}

/** Starts one tenbox command of the task as a Job on the cluster; with `--wait`, until it ends. */
export async function runOnMachine(
  args: MachineRunArgs,
): Promise<MachineRunResultJson | MachineWaitResultJson> {
  const { id, words, usage, waitSeconds } = args;
  if (words.length === 0) throw usageError(`usage: ${usage}`);
  const deadlineMs =
    waitSeconds === null ? null : Date.now() + waitSeconds * durations.MS_PER_SECOND;
  const { task, cmd, url } = await machines.run({ id, words, deadlineMs });
  if (deadlineMs === null) return { ok: true, task, cmd, url };
  const end = await machines.wait({ id, cmd, url, deadlineMs });
  return { ok: true, ...end };
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
  const { task, job, status, reason } = await machines.logs({
    id: args.id,
    follow: args.follow,
    write: (chunk) => process.stderr.write(chunk),
  });
  return { ok: true, task, job, status, reason };
}

/** Ends the running Jobs of the task; its volume stays. */
export async function stopMachine(id: TaskId): Promise<MachineStopResult> {
  const stopped = await machines.stop(id);
  return { ok: true, task: id, stopped };
}

/** Deletes the volume of the task on the cluster, after its close Job has ended. */
export async function removeMachineVolume(id: TaskId): Promise<MachineRmResult> {
  const volume = await machines.remove(id);
  return { ok: true, task: id, volume };
}
