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
import { approveTask } from "./commands/approve.ts";
import { closeTask } from "./commands/close.ts";
import { runChecks } from "./commands/check.ts";
import { install } from "./commands/install.ts";
import type { Failure } from "./commands/results.ts";
import { openPr } from "./commands/pr.ts";
import { recordProof } from "./commands/proof.ts";
import { startTask } from "./commands/start.ts";
import { TenboxError } from "../domain/errors/index.ts";
import { errorMessage, MS_PER_SECOND } from "../domain/utils.ts";
import { env, log } from "./infra/env.ts";
import { processes } from "./infra/processes.ts";
import { UsageError } from "../domain/errors/usage.ts";

interface Command extends ArgSpec {
  run(positionals: string[], values: Values): Promise<unknown>;
}

const START_USAGE = 'tenbox start <id> [--title "..."] [--base <branch>] [--no-setup] [--no-tmux]';
const CHECK_USAGE = "tenbox check <id> [--round N] [--base <branch>] [--timeout 600]";
const CLOSE_USAGE = "tenbox close <id> [--force]";
const PR_USAGE = "tenbox pr <id> [--ready]";
const PROOF_USAGE = "tenbox proof <id> --part NN --file F --test T --failure X";
const APPROVE_USAGE = "tenbox approve <id>";
const DEFAULT_TIMEOUT_SECONDS = 600;
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
      base: { type: "string" },
      setup: { type: "boolean", default: true },
      tmux: { type: "boolean", default: true },
    },
    run: (positionals, values) =>
      startTask({
        id: idArg(positionals, START_USAGE),
        title: stringValue(values, "title"),
        base: stringValue(values, "base"),
        setup: flagValue(values, "setup"),
        tmux: flagValue(values, "tmux"),
      }),
  },
  check: {
    usage: CHECK_USAGE,
    options: {
      round: { type: "string" },
      base: { type: "string" },
      timeout: { type: "string", default: String(DEFAULT_TIMEOUT_SECONDS) },
    },
    run: (positionals, values) =>
      runChecks({
        id: idArg(positionals, CHECK_USAGE),
        round: intValue(values, "round"),
        base: stringValue(values, "base"),
        timeoutMs: (intValue(values, "timeout") ?? DEFAULT_TIMEOUT_SECONDS) * MS_PER_SECOND,
      }),
  },
  close: {
    usage: CLOSE_USAGE,
    options: { force: { type: "boolean", default: false } },
    run: (positionals, values) =>
      closeTask({ id: idArg(positionals, CLOSE_USAGE), force: flagValue(values, "force") }),
  },
  pr: {
    usage: PR_USAGE,
    options: { ready: { type: "boolean", default: false } },
    run: (positionals, values) =>
      openPr({ id: idArg(positionals, PR_USAGE), ready: flagValue(values, "ready") }),
  },
  proof: {
    usage: PROOF_USAGE,
    options: {
      part: { type: "string" },
      file: { type: "string" },
      test: { type: "string" },
      failure: { type: "string" },
    },
    run: (positionals, values) =>
      recordProof({
        id: idArg(positionals, PROOF_USAGE),
        part: stringValue(values, "part"),
        file: stringValue(values, "file"),
        test: stringValue(values, "test"),
        failure: stringValue(values, "failure"),
      }),
  },
  approve: {
    usage: APPROVE_USAGE,
    options: {},
    run: (positionals) => approveTask(idArg(positionals, APPROVE_USAGE)),
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
  if (!command) throw new UsageError(`unknown command: ${name}`);
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
  process.exit(e instanceof UsageError ? USAGE_EXIT_CODE : FAILURE_EXIT_CODE);
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
      processes.stopAll();
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
