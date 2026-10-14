import { noStatsError, oldStatsError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { type StatsProof, trimProof } from "../../domain/proof.ts";
import { type RunAgent, summarizeRuns } from "../../domain/runs.ts";
import {
  checksPassed,
  countPlan,
  countPoints,
  countReview,
  distinctProofs,
  type PrMinutes,
  type PrTimes,
  readStatsAgents,
  STATS_SCHEMA,
  type StatsCode,
  type StatsRound,
  statsFile,
  sumCode,
  type TaskStats,
} from "../../domain/stats.ts";
import { checksFile, roundDir, roundNumbers, roundsDir } from "../../domain/task.ts";
import { minutesBetween } from "../../domain/utils.ts";
import { claudeSessions } from "../infra/claude/sessionFiles.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { builds } from "./builds.ts";
import { parts } from "./parts.ts";
import { plans } from "./plans.ts";
import { tasks } from "./tasks.ts";

export interface StatsInput {
  id: TaskId;
  project: string;
  forced: boolean;
  mainDir: string;
  taskWorktree: string;
  /** The task dir; the files are read from here. */
  taskDir: string;
  branch: string;
  /** The branch the diff starts from. */
  base: string;
  /** From `.tenbox/proofs.json`. */
  recordedProofs: StatsProof[];
  /** The merged PR; null without one and with `--force`. */
  pr: PrTimes | null;
}

/** Stats: the record of one closed task, `stats.json` in its task dir. */
export const stats = { compute, save, get };

/** Reads git, the task's `.tenbox/` files and its Claude Code sessions; a missing source gives null. */
async function compute(input: StatsInput): Promise<TaskStats> {
  const { id, project, forced, mainDir, taskWorktree, taskDir, branch, recordedProofs } = input;
  const task = await tasks.find(taskDir);
  const user = await git.findConfig(mainDir, "user.email");
  const tenbox = await git.findHead(env().tenboxRoot);
  const opened = await git.findBranchCreated(mainDir, branch);
  const closed = new Date().toISOString();
  const partIds = await parts.read(taskDir);
  const planResult = await plans.find(taskDir);
  const plan = countPlan(planResult);
  const build = await builds.find(taskDir);
  const rounds = await readRounds(taskDir);
  const code = await readCode(input);
  const runs = await claudeSessions.listRuns(taskWorktree);
  const summary = summarizeRuns(runs, opened);
  const taskProofs = distinctProofs(recordedProofs.map(trimProof));
  return {
    schema: STATS_SCHEMA,
    project,
    task: id,
    title: task?.title ?? null,
    user,
    tenbox,
    forced,
    timeline: { opened, ...summary.timeline, closed },
    minutes: {
      ...summary.minutes,
      ...prMinutes(summary.timeline.build_end, input.pr),
      total: minutesBetween(opened, closed),
    },
    plan,
    rounds,
    review: countReview(build),
    proofs: taskProofs,
    points: countPoints({
      partIds,
      proofs: taskProofs,
      unproven: build?.unproven ?? [],
    }),
    code,
    agents: summary.agents,
  };
}

interface StatsSource {
  id: TaskId;
  /** Null for a project with no id: it has no task dirs. */
  taskDir: string | null;
  taskWorktree: string;
}

export type StatsFrom = "stats.json" | "sessions";

interface FoundStats {
  from: StatsFrom;
  agents: RunAgent[];
}

/** The agents of `stats.json` when the task is closed, else of the worktree's session files; a `stats.json` of another schema is skipped. */
async function get(source: StatsSource): Promise<FoundStats> {
  const { id, taskDir, taskWorktree } = source;
  const text = await readText(taskDir);
  const recorded = text === null ? null : readStatsAgents(text);
  if (recorded !== null) return { from: "stats.json", agents: recorded };
  const runs = await claudeSessions.listRuns(taskWorktree);
  const { agents } = summarizeRuns(runs, null);
  if (agents === null) throw text === null ? noStatsError(id) : oldStatsError(id);
  return { from: "sessions", agents };
}

function readText(dir: string | null): Promise<string | null> {
  if (dir === null) return Promise.resolve(null);
  return files.read(statsFile(dir));
}

function prMinutes(buildEnd: string | null, pr: PrTimes | null): PrMinutes {
  return {
    review: minutesBetween(buildEnd, pr?.createdAt ?? null),
    wait_merge: minutesBetween(pr?.createdAt ?? null, pr?.mergedAt ?? null),
  };
}

async function save(taskStats: TaskStats, dir: string): Promise<void> {
  await files.writeJson(statsFile(dir), taskStats);
}

async function readRounds(dir: string): Promise<StatsRound[]> {
  const names = await files.list(roundsDir(dir));
  const rounds: StatsRound[] = [];
  for (const number of roundNumbers(names)) {
    const text = await files.read(checksFile(roundDir(dir, number)));
    rounds.push({ number, checks_passed: checksPassed(text) });
  }
  return rounds;
}

async function readCode(input: StatsInput): Promise<StatsCode | null> {
  const { mainDir, taskWorktree, base, branch } = input;
  const exists = await git.branchExists(mainDir, branch);
  if (!exists) return null;
  const changed = await git.listChangedFiles(mainDir, base, branch);
  const hasWorktree = await files.isDir(taskWorktree);
  const attrDir = hasWorktree ? taskWorktree : mainDir;
  const generated = await git.listGeneratedFiles(
    attrDir,
    changed.map((file) => file.path),
  );
  return sumCode(changed.filter((file) => !generated.includes(file.path)));
}
