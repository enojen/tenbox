#!/usr/bin/env bun
import type { Server } from "bun";
import type { CostReport, CostWindow } from "../domain/costs.ts";
import { errorMessage, TenboxError } from "../domain/errors/index.ts";
import { costs } from "./application/costs.ts";
import { nodes, type Watching } from "./application/nodes.ts";
import { projects } from "./application/projects.ts";
import { users } from "./application/users.ts";
import { readBackupArgs } from "./commands/backup.ts";
import { readCostsArgs } from "./commands/costs.ts";
import { readProjectAddArgs } from "./commands/projectAdd.ts";
import { readUserAddArgs } from "./commands/userAdd.ts";
import { type Db, database } from "./infra/db/index.ts";
import { type NodeWatchEnv, nodeWatchEnv, type ServerEnv, serverEnv } from "./infra/env.ts";
import { kubernetes } from "./infra/kubernetes.ts";
import { createApp } from "./routes/index.ts";

const FAILURE_EXIT_CODE = 1;
const USAGE =
  "usage: tenbox-server [user add --name <n> --github <g> --org <o> [--email <e>] [--type admin|member]]\n       tenbox-server project add --id <id> --name <n> --repo <r> --org <o>\n       tenbox-server backup --to <file>\n       tenbox-server costs --from <iso> --to <iso>";
const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

interface ErrorOutput {
  ok: false;
  error: string;
  code: string;
}

function main(args: string[]): void {
  const [command, subcommand, ...rest] = args;
  if (command === undefined) {
    serve();
    return;
  }
  if (command === "user" && subcommand === "add") {
    runUserAdd(rest);
    return;
  }
  if (command === "project" && subcommand === "add") {
    runProjectAdd(rest);
    return;
  }
  if (command === "backup") {
    runBackup([subcommand, ...rest].filter((arg) => arg !== undefined));
    return;
  }
  if (command === "costs") {
    runCosts([subcommand, ...rest].filter((arg) => arg !== undefined));
    return;
  }
  console.error(USAGE);
  process.exitCode = FAILURE_EXIT_CODE;
}

/** A bad env, such as no `HCLOUD_TOKEN` inside the cluster, stops the server before it serves. */
function serve(): void {
  try {
    serveWith(serverEnv(), nodeWatchEnv());
  } catch (error) {
    console.log(JSON.stringify(errorOutput(error)));
    process.exitCode = FAILURE_EXIT_CODE;
  }
}

function serveWith(env: ServerEnv, nodeEnv: NodeWatchEnv | null): void {
  const { host, port, dbFile } = env;
  const db = database.open(dbFile);
  const server = Bun.serve({ hostname: host, port, fetch: createApp(db).fetch });
  const watching = nodeEnv === null ? null : watchNodes(db, nodeEnv);
  stopOnSignals({ server, db, watching });
  console.error(`listening on http://${host}:${port}, docs on /docs`);
}

function watchNodes(db: Db, env: NodeWatchEnv): Watching {
  return nodes.watch(db, {
    kubernetes: kubernetes.inCluster(env.kubernetesUrl),
    hetzner: env.hetzner,
    now: () => new Date(),
  });
}

/** What runs until a stop signal. */
interface Running {
  server: Server<undefined>;
  db: Db;
  watching: Watching | null;
}

/** Lets open requests and a running poll finish, then closes the database; the process then exits with 0. */
function stopOnSignals(running: Running): void {
  const { server, db, watching } = running;
  const stop = async () => {
    await watching?.stop();
    await server.stop();
    database.close(db);
  };
  for (const signal of STOP_SIGNALS) process.once(signal, stop);
}

interface AddCommand<Input, Saved> {
  read: (argv: string[]) => Input;
  save: (db: Db, input: Input) => Saved;
}

function runUserAdd(argv: string[]): void {
  runAdd(argv, { read: readUserAddArgs, save: users.save });
}

function runProjectAdd(argv: string[]): void {
  runAdd(argv, { read: readProjectAddArgs, save: projects.save });
}

function runBackup(argv: string[]): void {
  try {
    const args = readBackupArgs(argv);
    if (args === null) {
      console.error(USAGE);
      process.exitCode = FAILURE_EXIT_CODE;
      return;
    }
    backupOnce(args.to);
    console.log(JSON.stringify({ ok: true, file: args.to }));
  } catch (error) {
    console.log(JSON.stringify(errorOutput(error)));
    process.exitCode = FAILURE_EXIT_CODE;
  }
}

function runCosts(argv: string[]): void {
  try {
    const window = readCostsArgs(argv);
    console.log(JSON.stringify({ ok: true, ...costsOnce(window) }));
  } catch (error) {
    console.log(JSON.stringify(errorOutput(error)));
    process.exitCode = FAILURE_EXIT_CODE;
  }
}

/** The same report as `GET /costs`; it never creates or changes a database. */
function costsOnce(window: CostWindow): CostReport {
  const db = database.openReadOnly(serverEnv().dbFile);
  try {
    return costs.get(db, window);
  } finally {
    database.close(db);
  }
}

function backupOnce(file: string): void {
  database.backup({ from: serverEnv().dbFile, to: file });
}

function runAdd<Input, Saved extends object>(
  argv: string[],
  command: AddCommand<Input, Saved>,
): void {
  try {
    const saved = saveOnce(command, command.read(argv));
    console.log(JSON.stringify({ ok: true, ...saved }));
  } catch (error) {
    console.log(JSON.stringify(errorOutput(error)));
    process.exitCode = FAILURE_EXIT_CODE;
  }
}

/** One command, one connection: open, save, close, also on an error. */
function saveOnce<Input, Saved>(command: AddCommand<Input, Saved>, input: Input): Saved {
  const db = database.open(serverEnv().dbFile);
  try {
    return command.save(db, input);
  } finally {
    database.close(db);
  }
}

function errorOutput(error: unknown): ErrorOutput {
  const code = error instanceof TenboxError ? error.code : "error";
  return { ok: false, error: errorMessage(error), code };
}

main(process.argv.slice(2));
