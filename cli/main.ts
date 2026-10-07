#!/usr/bin/env bun
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { install } from "./app/install.ts";
import { runChecks } from "./app/runChecks.ts";
import { startTask } from "./app/startTask.ts";
import { TenboxError } from "./domain/errors.ts";
import { taskId } from "./domain/ids.ts";
import type { Failure } from "./app/results.ts";
import { realPorts } from "./infra/index.ts";
import type { Ports } from "./ports.ts";

type Values = Record<string, string | boolean | undefined>;

interface Command {
  usage: string;
  options: ParseArgsOptionsConfig;
  run(ports: Ports, positionals: string[], values: Values): Promise<unknown>;
}

function intValue(values: Values, name: string): number | undefined {
  const v = values[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !/^[0-9]+$/.test(v)) throw new TenboxError(`--${name} must be a whole number`, "usage");
  return Number(v);
}

function idArg(positionals: string[], usage: string) {
  const raw = positionals[0];
  if (!raw) throw new TenboxError(`usage: ${usage}`, "usage");
  return taskId(raw);
}

const COMMANDS: Record<string, Command> = {
  start: {
    usage: 'tenbox start <id> [--title "..."] [--base main] [--no-setup] [--no-tmux]',
    options: {
      title: { type: "string" },
      base: { type: "string", default: "main" },
      setup: { type: "boolean", default: true },
      tmux: { type: "boolean", default: true },
    },
    run: (ports, positionals, v) =>
      startTask(ports, {
        id: idArg(positionals, COMMANDS.start!.usage),
        title: v.title as string | undefined,
        base: v.base as string,
        setup: v.setup as boolean,
        tmux: v.tmux as boolean,
      }),
  },
  check: {
    usage: "tenbox check <id> [--round N] [--base main] [--timeout 600]",
    options: {
      round: { type: "string" },
      base: { type: "string", default: "main" },
      timeout: { type: "string", default: "600" },
    },
    run: (ports, positionals, v) =>
      runChecks(ports, {
        id: idArg(positionals, COMMANDS.check!.usage),
        round: intValue(v, "round"),
        base: v.base as string,
        timeoutMs: intValue(v, "timeout")! * 1000,
      }),
  },
  install: {
    usage: "tenbox install",
    options: {},
    run: (ports) => install(ports),
  },
};

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help") {
    for (const c of Object.values(COMMANDS)) process.stderr.write(`  ${c.usage}\n`);
    emit({ ok: true, commands: Object.fromEntries(Object.entries(COMMANDS).map(([k, c]) => [k, c.usage])) });
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) throw new TenboxError(`unknown command: ${name}`, "usage");
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: rest, options: command.options, allowPositionals: true, allowNegative: true, strict: true });
  } catch (e) {
    throw new TenboxError(`${(e as Error).message}\nusage: ${command.usage}`, "usage");
  }
  emit(await command.run(realPorts(), parsed.positionals, parsed.values as Values));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    const failure: Failure =
      e instanceof TenboxError
        ? { ok: false, error: e.message, code: e.code, ...(e.details !== undefined ? { details: e.details } : {}) }
        : { ok: false, error: e instanceof Error ? e.message : String(e), code: "internal" };
    emit(failure);
    process.exit(failure.code === "usage" ? 2 : 1);
  },
);
