import os from "node:os";
import path from "node:path";
import { TenboxError } from "../../domain/errors.ts";

export interface ServerEnv {
  /** `TENBOX_SERVER_PORT`, default 4300. */
  port: number;
  /** `TENBOX_SERVER_DB`, default `~/.tenbox-server/server.db`. */
  dbFile: string;
}

const DEFAULT_PORT = 4300;
const MAX_PORT = 65535;

/** Read at each call, so tests can set `process.env` first. Bun loads `.env` by itself. */
export function serverEnv(): ServerEnv {
  return {
    port: port(process.env.TENBOX_SERVER_PORT),
    dbFile: process.env.TENBOX_SERVER_DB ?? path.join(os.homedir(), ".tenbox-server", "server.db"),
  };
}

function port(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 1 && value <= MAX_PORT) return value;
  throw new TenboxError(`TENBOX_SERVER_PORT "${raw}": a number from 1 to ${MAX_PORT}`, "env");
}
