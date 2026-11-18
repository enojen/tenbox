import { usageError } from "../../domain/errors/usage.ts";
import type { TaskId } from "../../domain/ids.ts";
import { durations } from "../../domain/utils.ts";
import { machines } from "../application/machines.ts";
import type {
  MachineLogsResultJson,
  MachineLsResult,
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
  const { task, cmd, run } = await machines.run({ id, words, deadlineMs });
  if (deadlineMs === null) return { ok: true, task, cmd, run };
  const end = await machines.wait({ id, cmd, run, deadlineMs });
  return { ok: true, ...end };
}

/** The runs of the given tasks, as Tenport keeps them. */
export async function listMachineRuns(ids: TaskId[]): Promise<MachineLsResult> {
  const runs = await machines.list(ids);
  return { ok: true, runs };
}

export interface MachineLogsArgs {
  id: TaskId;
  follow: boolean;
}

/** Writes the box log of the task's newest run to stderr. */
export async function showMachineLogs(args: MachineLogsArgs): Promise<MachineLogsResultJson> {
  const { task, run, phase, reason } = await machines.logs({
    id: args.id,
    follow: args.follow,
    write: (chunk) => process.stderr.write(chunk),
  });
  return { ok: true, task, run, phase, reason };
}

/** Stops the running runs of the task; its archive stays. */
export async function stopMachine(id: TaskId): Promise<MachineStopResult> {
  const stopped = await machines.stop(id);
  return { ok: true, task: id, stopped };
}
