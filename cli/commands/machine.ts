import { usageError } from "../../domain/errors/usage.ts";
import type { TaskId } from "../../domain/ids.ts";
import { machines } from "../application/machines.ts";
import type {
  MachineLsResult,
  MachineRmResult,
  MachineRunResultJson,
  MachineStopResult,
} from "./results.ts";

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

/** Ends the running Job of the task; its volume stays. */
export async function stopMachine(id: TaskId): Promise<MachineStopResult> {
  const stopped = await machines.stop(id);
  return { ok: true, task: id, stopped };
}

/** Deletes the volume of the task on the cluster, after its close Job has ended. */
export async function removeMachineVolume(id: TaskId): Promise<MachineRmResult> {
  const volume = await machines.remove(id);
  return { ok: true, task: id, volume };
}
