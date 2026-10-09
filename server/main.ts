#!/usr/bin/env bun
import type { Server } from "bun";
import { TenboxError } from "../domain/errors/index.ts";
import { errorMessage } from "../domain/utils.ts";
import { type NewUser, type SavedUser, users } from "./application/users.ts";
import { readUserAddArgs } from "./commands/userAdd.ts";
import { type Db, database } from "./infra/db/index.ts";
import { serverEnv } from "./infra/env.ts";
import { createApp } from "./routes/index.ts";

/** Loopback only: tokens travel over plain HTTP with no TLS, so on a network they could be read. */
const SERVER_HOST = "localhost";
const FAILURE_EXIT_CODE = 1;
const USAGE =
  "usage: tenbox-server [user add --name <n> --github <g> --org <o> [--email <e>] [--type admin|member]]";
const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

interface ErrorOutput {
  ok: false;
  error: string;
  code: string;
}

function main(args: string[]): void {
  const [command, subcommand, ...rest] = args;
  if (command === undefined) return serve();
  if (command === "user" && subcommand === "add") return runUserAdd(rest);
  console.error(USAGE);
  process.exitCode = FAILURE_EXIT_CODE;
}

function serve(): void {
  const { port, dbFile } = serverEnv();
  const db = database.open(dbFile);
  const server = Bun.serve({ hostname: SERVER_HOST, port, fetch: createApp(db).fetch });
  stopOnSignals(server, db);
  console.error(`listening on http://${SERVER_HOST}:${port}, docs on /docs`);
}

/** Lets open requests finish, then closes the database; the process then exits with 0. */
function stopOnSignals(server: Server<undefined>, db: Db): void {
  const stop = async () => {
    await server.stop();
    database.close(db);
  };
  for (const signal of STOP_SIGNALS) process.once(signal, stop);
}

function runUserAdd(argv: string[]): void {
  try {
    const input = readUserAddArgs(argv);
    const saved = addUser(input);
    console.log(JSON.stringify({ ok: true, ...saved }));
  } catch (error) {
    console.log(JSON.stringify(errorOutput(error)));
    process.exitCode = FAILURE_EXIT_CODE;
  }
}

/** One command, one connection: open, write the user, close, also on an error. */
function addUser(input: NewUser): SavedUser {
  const db = database.open(serverEnv().dbFile);
  try {
    return users.save(db, input);
  } finally {
    database.close(db);
  }
}

function errorOutput(error: unknown): ErrorOutput {
  const code = error instanceof TenboxError ? error.code : "error";
  return { ok: false, error: errorMessage(error), code };
}

main(process.argv.slice(2));
