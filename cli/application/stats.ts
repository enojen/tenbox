import path from "node:path";
import type { TaskId } from "../../domain/ids.ts";
import { type StatsProof, trimProof } from "../../domain/proof.ts";
import { summarizeRuns } from "../../domain/runs.ts";
import {
  checksPassed,
  countPlan,
  countPoints,
  distinctProofs,
  STATS_SCHEMA,
  type StatsCode,
  type StatsRound,
  statsFile,
  sumCode,
  type TaskStats,
} from "../../domain/stats.ts";
import { roundNumbers, titleFromTaskMd } from "../../domain/task.ts";
import { minutesBetween } from "../../domain/utils.ts";
import { claudeSessions } from "../infra/claudeSessions.ts";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { parts } from "./parts.ts";

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
}

/** Stats: the record of one closed task, `stats.json` in its task dir. */
export const stats = { compute, save };

/** Reads git, the task's `.tenbox/` files and its Claude Code sessions; a missing source gives null. */
async function compute(input: StatsInput): Promise<TaskStats> {
  const { id, project, forced, mainDir, taskWorktree, taskDir, branch, recordedProofs } = input;
  const taskMd = await files.read(path.join(taskDir, "task.md"));
  const user = await git.findConfig(mainDir, "user.email");
  const tenbox = await git.findHead(env().tenboxRoot);
  const opened = await git.findBranchCreated(mainDir, branch);
  const closed = new Date().toISOString();
  const planText = await files.read(path.join(taskDir, "plan.md"));
  const partFiles = await parts.read(taskDir);
  const plan = countPlan(
    planText,
    partFiles.map((part) => part.text),
  );
  const rounds = await readRounds(taskDir);
  const code = await readCode(input);
  const runs = await claudeSessions.listRuns(taskWorktree);
  const summary = summarizeRuns(runs, opened, closed);
  const taskProofs = distinctProofs([...summary.proofs, ...recordedProofs].map(trimProof));
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
    proofs: taskProofs,
    points: countPoints({
      partIds: partFiles.map((part) => part.id),
      proofs: taskProofs,
      unproven: summary.unproven,
    }),
    code,
    agents: summary.agents,
  };
}

async function save(taskStats: TaskStats, dir: string): Promise<void> {
  await files.write(statsFile(dir), `${JSON.stringify(taskStats, null, 2)}\n`);
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
