import { parseArgs } from "node:util";

export interface BackupArgs {
  to: string;
}

/** Null when `--to` is missing: the caller prints the usage. */
export function readBackupArgs(argv: string[]): BackupArgs | null {
  const { values } = parseArgs({ args: argv, options: { to: { type: "string" } }, strict: true });
  return values.to ? { to: values.to } : null;
}
