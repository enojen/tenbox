#!/usr/bin/env bun
import {
  type ArgSpec,
  flagValue,
  idArg,
  intValue,
  parseCommandArgs,
  stringValue,
  type Values,
} from "./args.ts";
import { closeTask } from "./application/commands/close.ts";
import { runChecks } from "./application/commands/check.ts";
import { install } from "./application/commands/install.ts";
import type { Failure } from "./application/commands/results.ts";
import { startTask } from "./application/commands/start.ts";
import { TenboxError } from "./domain/errors.ts";
import { errorMessage } from "./domain/utils.ts";
import { env, log } from "./infra/env.ts";
import { stopAll } from "./infra/spawn.ts";

interface Command extends ArgSpec {
  run(positionals: string[], values: Values): Promise<unknown>;
}

const START_USAGE = 'tenbox start <id> [--title "..."] [--base main] [--no-setup] [--no-tmux]';
const CHECK_USAGE = "tenbox check <id> [--round N] [--base main] [--timeout 600]";
const CLOSE_USAGE = "tenbox close <id> [--force]";
const DEFAULT_BASE = "main";
const DEFAULT_TIMEOUT_SECONDS = 600;
const MS_PER_SECOND = 1000;
const USAGE_EXIT_CODE = 2;
const FAILURE_EXIT_CODE = 1;
/** 128 + the signal number, as shells report it. */
const STOP_SIGNALS = [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const;

const COMMANDS: Record<string, Command> = {
  start: {
    usage: START_USAGE,
    options: {
      title: { type: "string" },
      base: { type: "string", default: DEFAULT_BASE },
      setup: { type: "boolean", default: true },
      tmux: { type: "boolean", default: true },
    },
    run: (positionals, values) =>
      startTask({
        id: idArg(positionals, START_USAGE),
        title: stringValue(values, "title"),
        base: stringValue(values, "base") ?? DEFAULT_BASE,
        setup: flagValue(values, "setup"),
        tmux: flagValue(values, "tmux"),
      }),
  },
  check: {
    usage: CHECK_USAGE,
    options: {
      round: { type: "string" },
      base: { type: "string", default: DEFAULT_BASE },
      timeout: { type: "string", default: String(DEFAULT_TIMEOUT_SECONDS) },
    },
    run: (positionals, values) =>
      runChecks({
        id: idArg(positionals, CHECK_USAGE),
        round: intValue(values, "round"),
        base: stringValue(values, "base") ?? DEFAULT_BASE,
        timeoutMs: (intValue(values, "timeout") ?? DEFAULT_TIMEOUT_SECONDS) * MS_PER_SECOND,
      }),
  },
  close: {
    usage: CLOSE_USAGE,
    options: { force: { type: "boolean", default: false } },
    run: (positionals, values) =>
      closeTask({ id: idArg(positionals, CLOSE_USAGE), force: flagValue(values, "force") }),
  },
  install: {
    usage: "tenbox install",
    options: {},
    run: () => install(),
  },
};

async function main(argv: string[]): Promise<void> {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help") {
    printHelp();
    return;
  }
  const command = COMMANDS[name];
  if (!command) throw new TenboxError(`unknown command: ${name}`, "usage");
  const parsed = parseCommandArgs(command, rest);
  const result = await command.run(parsed.positionals, parsed.values);
  emit(result);
}

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  const usages = Object.entries(COMMANDS).map(([name, command]) => [name, command.usage]);
  for (const [, usage] of usages) process.stderr.write(`  ${usage}\n`);
  emit({ ok: true, commands: Object.fromEntries(usages) });
}

function toFailure(e: unknown): Failure {
  if (!(e instanceof TenboxError)) return { ok: false, error: errorMessage(e), code: "internal" };
  const details = e.details !== undefined ? { details: e.details } : {};
  return { ok: false, error: e.message, code: e.code, ...details };
}

function exitWithFailure(e: unknown): never {
  const failure = toFailure(e);
  emit(failure);
  printStack(e);
  process.exit(failure.code === "usage" ? USAGE_EXIT_CODE : FAILURE_EXIT_CODE);
}

/** Internal errors always show their stack; Tenbox's own errors only with TENBOX_DEBUG=1. */
function printStack(e: unknown): void {
  if (!(e instanceof Error)) return;
  if (e instanceof TenboxError && !env().debug) return;
  log(e.stack ?? e.message);
}

function exitOnStop(): void {
  for (const [signal, code] of STOP_SIGNALS) {
    process.on(signal, () => {
      stopAll();
      process.exit(code);
    });
  }
}

exitOnStop();
try {
  await main(process.argv.slice(2));
} catch (e) {
  exitWithFailure(e);
}
