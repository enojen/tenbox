import { noStatsError, oldStatsError } from "../../domain/errors/stats.ts";
import type { TaskId } from "../../domain/ids.ts";
import { type StatsProof, trimProof } from "../../domain/proofs.ts";
import { roundNumbers } from "../../domain/rounds.ts";
import { type RunAgent, type RunMark, summarizeRuns } from "../../domain/runs.ts";
import {
  countPlan,
  countPoints,
  countReview,
  distinctProofs,
  type PrMinutes,
  type PrTimes,
  readStatsRecord,
  STATS_SCHEMA,
  type StatsCode,
  type StatsRound,
  sumCode,
  type TaskStats,
} from "../../domain/stats.ts";
import { buildFile, checksFile, roundDir, roundsDir, statsFile } from "../../domain/taskDirs.ts";
import { durations } from "../../domain/utils.ts";
import { claudeSessions } from "../infra/claude/sessionFiles.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { builds } from "./builds.ts";
import { checks } from "./checks.ts";
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
      total: durations.minutesBetween(opened, closed),
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
    runs: summary.runs,
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
  /** Null for a schema 5 `stats.json`, which has no runs. */
  runs: RunMark[] | null;
}

/** The agents and runs of `stats.json` when the task is closed, else of the worktree's session files; a `stats.json` of another schema is skipped. */
async function get(source: StatsSource): Promise<FoundStats> {
  const { id, taskDir, taskWorktree } = source;
  const file = taskDir === null ? null : statsFile(taskDir);
  const text = await readText(file);
  const recorded = file === null || text === null ? null : readStatsRecord(text, file);
  if (recorded !== null) return { from: "stats.json", ...recorded };
  const runs = await claudeSessions.listRuns(taskWorktree);
  const summary = summarizeRuns(runs, null);
  const { agents } = summary;
  if (agents === null) throw text === null ? noStatsError(id) : oldStatsError(id);
  return { from: "sessions", agents, runs: summary.runs };
}

function readText(file: string | null): Promise<string | null> {
  if (file === null) return Promise.resolve(null);
  return files.read(file);
}

function prMinutes(buildEnd: string | null, pr: PrTimes | null): PrMinutes {
  return {
    review: nonNegative(durations.minutesBetween(buildEnd, pr?.createdAt ?? null)),
    wait_merge: durations.minutesBetween(pr?.createdAt ?? null, pr?.mergedAt ?? null),
  };
}

/** `tenbox build done` opens the PR inside the build run, so the PR can predate the run's end. */
function nonNegative(minutes: number | null): number | null {
  return minutes === null ? null : Math.max(0, minutes);
}

async function save(taskStats: TaskStats, dir: string): Promise<void> {
  await files.writeJson(statsFile(dir), taskStats);
}

/** The build rounds: a round whose `checks.json` is newer than `build.json` is a check run by hand after the build. */
async function readRounds(dir: string): Promise<StatsRound[]> {
  const names = await files.list(roundsDir(dir));
  const builtAt = await findMtime(buildFile(dir));
  const rounds: StatsRound[] = [];
  for (const number of roundNumbers(names)) {
    const file = checksFile(roundDir(dir, number));
    const checkedAt = await findMtime(file);
    if (builtAt !== null && checkedAt !== null && checkedAt > builtAt) continue;
    const result = await checks.find(file);
    rounds.push({ number, checks_passed: result?.ok ?? null });
  }
  return rounds;
}

async function findMtime(file: string): Promise<number | null> {
  const exists = await files.exists(file);
  if (!exists) return null;
  return files.mtime(file);
}

async function readCode(input: StatsInput): Promise<StatsCode | null> {
  const { mainDir, taskWorktree, base, branch } = input;
  const exists = await git.branchExists(mainDir, branch);
  if (!exists) return null;
  const changed = await git.listDiffFiles(mainDir, base, branch);
  const hasWorktree = await files.isDir(taskWorktree);
  const attrDir = hasWorktree ? taskWorktree : mainDir;
  const generated = await git.listGeneratedFiles(
    attrDir,
    changed.map((file) => file.path),
  );
  return sumCode(changed.filter((file) => !generated.includes(file.path)));
}
