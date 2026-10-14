#!/usr/bin/env bun
import { TenboxError } from "../domain/errors/index.ts";
import { usageError } from "../domain/errors/usage.ts";
import { errorMessage, isDigits, MS_PER_SECOND } from "../domain/utils.ts";
import {
  type ArgSpec,
  flagValue,
  idArg,
  intValue,
  parseCommandArgs,
  stringValue,
  tierValue,
  type Values,
} from "./args.ts";
import { answerCard } from "./commands/answer.ts";
import { approveTask } from "./commands/approve.ts";
import { checkApproved } from "./commands/approved.ts";
import { attachTask } from "./commands/attach.ts";
import { buildDone, sendBuild } from "./commands/build.ts";
import { runChecks } from "./commands/check.ts";
import { closeTask } from "./commands/close.ts";
import { decide } from "./commands/decide.ts";
import { install } from "./commands/install.ts";
import { mergeCheck } from "./commands/mergeCheck.ts";
import { planDone } from "./commands/plan.ts";
import { openPr } from "./commands/pr.ts";
import { recordProof } from "./commands/proof.ts";
import type { Failure } from "./commands/results.ts";
import { startTask } from "./commands/start.ts";
import { showStats } from "./commands/stats.ts";
import { isWaitKind, waitFor } from "./commands/wait.ts";
import { env, log } from "./infra/env.ts";
import { processes } from "./infra/processes.ts";

interface Command extends ArgSpec {
  run(positionals: string[], values: Values): Promise<unknown>;
}

const START_USAGE =
  'tenbox start <id> [--title "..."] [--base <branch>] [--no-setup] [--no-claude]';
const CHECK_USAGE =
  "tenbox check <id> [--tier fast|full] [--round N] [--base <branch>] [--timeout 600]";
const MERGE_CHECK_USAGE = "tenbox merge-check [--base <branch>]";
const CLOSE_USAGE = "tenbox close <id> [--force]";
const PR_USAGE = "tenbox pr <id> [--ready]";
const PROOF_USAGE = "tenbox proof <id> --part NN --file F --test T --failure X";
const DECIDE_USAGE = "tenbox decide <id> --json '[{ question?, answer }]'";
const PLAN_USAGE = "tenbox plan done <id> --json '<result>'";
const BUILD_DONE_USAGE = "tenbox build done <id> --json '<result>'";
const WAIT_USAGE = "tenbox wait <id> --for plan|build|round [--timeout 600]";
const ANSWER_USAGE = "tenbox answer <id> <n>";
const APPROVE_USAGE = "tenbox approve <id>";
const APPROVED_USAGE = "tenbox approved <id>";
const STATS_USAGE = "tenbox stats <id>";
const BUILD_USAGE = "tenbox build <id>";
const ATTACH_USAGE = "tenbox attach <id>";
const DEFAULT_TIMEOUT_SECONDS = 600;
const USAGE_EXIT_CODE = 2;
const FAILURE_EXIT_CODE = 1;
/** 128 + the signal number, as shells report it. */
const SIGINT_EXIT_CODE = 130;
const SIGTERM_EXIT_CODE = 143;
const STOP_SIGNALS = [
  ["SIGINT", SIGINT_EXIT_CODE],
  ["SIGTERM", SIGTERM_EXIT_CODE],
] as const;

const COMMANDS: Record<string, Command> = {
  start: {
    usage: START_USAGE,
    options: {
      title: { type: "string" },
      base: { type: "string" },
      setup: { type: "boolean", default: true },
      claude: { type: "boolean", default: true },
    },
    run: (positionals, values) =>
      startTask({
        id: idArg(positionals, START_USAGE),
        title: stringValue(values, "title"),
        base: stringValue(values, "base"),
        setup: flagValue(values, "setup"),
        claude: flagValue(values, "claude"),
      }),
  },
  check: {
    usage: CHECK_USAGE,
    options: {
      tier: { type: "string" },
      round: { type: "string" },
      base: { type: "string" },
      timeout: { type: "string", default: String(DEFAULT_TIMEOUT_SECONDS) },
    },
    run: (positionals, values) =>
      runChecks({
        id: idArg(positionals, CHECK_USAGE),
        round: intValue(values, "round"),
        tier: tierValue(values),
        base: stringValue(values, "base"),
        timeoutMs: (intValue(values, "timeout") ?? DEFAULT_TIMEOUT_SECONDS) * MS_PER_SECOND,
      }),
  },
  "merge-check": {
    usage: MERGE_CHECK_USAGE,
    options: { base: { type: "string" } },
    run: (_positionals, values) =>
      mergeCheck({
        base: stringValue(values, "base"),
        timeoutMs: DEFAULT_TIMEOUT_SECONDS * MS_PER_SECOND,
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
  decide: {
    usage: DECIDE_USAGE,
    options: { json: { type: "string" } },
    run: (positionals, values) => {
      const json = stringValue(values, "json");
      if (!json) throw usageError(`usage: ${DECIDE_USAGE}`);
      return decide({ id: idArg(positionals, DECIDE_USAGE), json });
    },
  },
  plan: {
    usage: PLAN_USAGE,
    options: { json: { type: "string" } },
    run: (positionals, values) => {
      const [action, ...rest] = positionals;
      const json = stringValue(values, "json");
      if (action !== "done" || !json) throw usageError(`usage: ${PLAN_USAGE}`);
      return planDone({ id: idArg(rest, PLAN_USAGE), json });
    },
  },
  build: {
    usage: `${BUILD_USAGE} | ${BUILD_DONE_USAGE}`,
    options: { json: { type: "string" } },
    run: (positionals, values) => {
      const [first, ...rest] = positionals;
      if (first !== "done") return sendBuild(idArg(positionals, BUILD_USAGE));
      const json = stringValue(values, "json");
      if (!json) throw usageError(`usage: ${BUILD_DONE_USAGE}`);
      return buildDone({ id: idArg(rest, BUILD_DONE_USAGE), json });
    },
  },
  attach: {
    usage: ATTACH_USAGE,
    options: {},
    run: (positionals) => attachTask(idArg(positionals, ATTACH_USAGE)),
  },
  wait: {
    usage: WAIT_USAGE,
    options: {
      for: { type: "string" },
      timeout: { type: "string", default: String(DEFAULT_TIMEOUT_SECONDS) },
    },
    run: (positionals, values) => {
      const kind = stringValue(values, "for");
      if (!isWaitKind(kind)) throw usageError(`usage: ${WAIT_USAGE}`);
      return waitFor({
        id: idArg(positionals, WAIT_USAGE),
        kind,
        timeoutSeconds: intValue(values, "timeout") ?? DEFAULT_TIMEOUT_SECONDS,
      });
    },
  },
  answer: {
    usage: ANSWER_USAGE,
    options: {},
    run: (positionals) => {
      const [, option = ""] = positionals;
      if (!isDigits(option)) throw usageError(`usage: ${ANSWER_USAGE}`);
      return answerCard({ id: idArg(positionals, ANSWER_USAGE), option: Number(option) });
    },
  },
  approve: {
    usage: APPROVE_USAGE,
    options: {},
    run: (positionals) => approveTask(idArg(positionals, APPROVE_USAGE)),
  },
  approved: {
    usage: APPROVED_USAGE,
    options: {},
    run: (positionals) => checkApproved(idArg(positionals, APPROVED_USAGE)),
  },
  stats: {
    usage: STATS_USAGE,
    options: {},
    run: (positionals) => showStats(idArg(positionals, STATS_USAGE)),
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
  if (!command) throw usageError(`unknown command: ${name}`);
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
  process.exit(
    e instanceof TenboxError && e.code === "usage" ? USAGE_EXIT_CODE : FAILURE_EXIT_CODE,
  );
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
