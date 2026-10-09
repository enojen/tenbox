import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { type TaskId, taskId } from "../domain/ids.ts";
import { errorMessage, isDigits } from "../domain/utils.ts";
import { UsageError } from "../domain/errors/usage.ts";

type OptionValue = string | boolean | Array<string | boolean> | undefined;
export type Values = Record<string, OptionValue>;

export interface ParsedArgs {
  values: Values;
  positionals: string[];
}

export interface ArgSpec {
  usage: string;
  options: ParseArgsOptionsConfig;
}

/** Strict parsing: an unknown flag is a usage error that shows the command's usage. */
export function parseCommandArgs(spec: ArgSpec, args: string[]): ParsedArgs {
  try {
    return parseArgs({
      args,
      options: spec.options,
      allowPositionals: true,
      allowNegative: true,
      strict: true,
    });
  } catch (e) {
    throw new UsageError(`${errorMessage(e)}\nusage: ${spec.usage}`);
  }
}

export function idArg(positionals: string[], usage: string): TaskId {
  const raw = positionals[0];
  if (!raw) throw new UsageError(`usage: ${usage}`);
  return taskId(raw);
}

export function intValue(values: Values, name: string): number | undefined {
  const value = values[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isDigits(value)) {
    throw new UsageError(`--${name} must be a whole number`);
  }
  return Number(value);
}

export function stringValue(values: Values, name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

export function flagValue(values: Values, name: string): boolean {
  return values[name] === true;
}
