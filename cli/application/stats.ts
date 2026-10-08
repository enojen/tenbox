import path from "node:path";
import type { TaskId } from "../domain/ids.ts";
import { summarizeRuns } from "../domain/runs.ts";
import {
  checksPassed,
  countPlan,
  STATS_SCHEMA,
  type StatsCode,
  type StatsPlan,
  type StatsRound,
  statsFile,
  sumCode,
  type TaskStats,
} from "../domain/stats.ts";
import { roundNumbers, titleFromTaskMd } from "../domain/task.ts";
import { minutesBetween } from "../domain/utils.ts";
import { claudeSessions } from "../infra/claudeSessions.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";

export interface StatsInput {
  id: TaskId;
  project: string;
  forced: boolean;
  mainDir: string;
  taskWorktree: string;
  /** Where close moved `.tenbox/`; the files are read from here. */
  archive: string;
  branch: string;
  /** The branch the diff starts from. */
  base: string;
}

/** Stats: the record of one closed task, `stats.json` in its archive. */
export const stats = { compute, save };

/** Reads git, the task's `.tenbox/` files and its Claude Code sessions; a missing source gives null. */
async function compute(input: StatsInput): Promise<TaskStats> {
  const { id, project, forced, mainDir, taskWorktree, archive, branch } = input;
  const taskMd = await files.read(path.join(archive, "task.md"));
  const user = await git.findConfig(mainDir, "user.email");
  const tenbox = await git.findHead(env().tenboxRoot);
  const opened = await git.findBranchCreated(mainDir, branch);
  const closed = new Date().toISOString();
  const plan = await readPlan(archive);
  const rounds = await readRounds(archive);
  const code = await readCode(input);
  const runs = await claudeSessions.listRuns(taskWorktree);
  const summary = summarizeRuns(runs, opened, closed);
  return {
    schema: STATS_SCHEMA,
    project,
    task: id,
    title: titleFromTaskMd(taskMd),
    user,
    tenbox,
    forced,
    timeline: { opened, ...summary.timeline, closed },
    minutes: { ...summary.minutes, total: minutesBetween(opened, closed) },
    plan,
    rounds,
    review: summary.review,
    code,
    agents: summary.agents,
  };
}

async function save(taskStats: TaskStats, archive: string): Promise<void> {
  await files.write(statsFile(archive), `${JSON.stringify(taskStats, null, 2)}\n`);
}

async function readPlan(dir: string): Promise<StatsPlan | null> {
  const planText = await files.read(path.join(dir, "plan.md"));
  const partsDir = path.join(dir, "parts");
  const names = await files.list(partsDir);
  const partTexts: string[] = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const text = await files.read(path.join(partsDir, name));
    partTexts.push(text ?? "");
  }
  return countPlan(planText, partTexts);
}

async function readRounds(dir: string): Promise<StatsRound[]> {
  const roundsDir = path.join(dir, "rounds");
  const names = await files.list(roundsDir);
  const rounds: StatsRound[] = [];
  for (const number of roundNumbers(names)) {
    const text = await files.read(path.join(roundsDir, String(number), "checks.json"));
    rounds.push({ number, checks_passed: checksPassed(text) });
  }
  return rounds;
}

async function readCode(input: StatsInput): Promise<StatsCode | null> {
  const { mainDir, base, branch } = input;
  const exists = await git.branchExists(mainDir, branch);
  if (!exists) return null;
  const changed = await git.listChangedFiles(mainDir, base, branch);
  return sumCode(changed);
}
