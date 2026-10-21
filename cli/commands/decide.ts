import { parseDecisions } from "../../domain/decision.ts";
import type { TaskId } from "../../domain/ids.ts";
import { decisions } from "../application/decisions.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { sendBuild } from "./build.ts";
import type { DecideResult } from "./results.ts";

export interface DecideInput {
  id: TaskId;
  /** The decisions as JSON text: `[{ question?, answer } | { decision, taken }]`. */
  json: string;
  /** Send `/tenbox-build <id>` after the answers are written. */
  build: boolean;
}

/** Appends the answers to `.tenbox/decisions.md`, ticks their questions, takes the plan options, then sends the build. */
export async function decide(input: DecideInput): Promise<DecideResult> {
  const items = parseDecisions(input.json);
  const taskWorktree = await worktrees.get(input.id);
  const saved = await decisions.save(taskWorktree, items);
  const result: DecideResult = { ok: true, task: input.id, ...saved };
  if (!input.build) return result;
  const { sent } = await sendBuild(input.id);
  return { ...result, sent };
}
