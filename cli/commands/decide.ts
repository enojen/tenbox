import { parseDecisions } from "../../domain/decision.ts";
import type { TaskId } from "../../domain/ids.ts";
import { decisions } from "../application/decisions.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { DecideResult } from "./results.ts";

export interface DecideInput {
  id: TaskId;
  /** The decisions as JSON text: `[{ question?, answer }]`. */
  json: string;
}

/** Appends the answers to `.tenbox/decisions.md` and ticks their questions in `questions.md`. */
export async function decide(input: DecideInput): Promise<DecideResult> {
  const items = parseDecisions(input.json);
  const taskWorktree = await worktrees.get(input.id);
  const saved = await decisions.save(taskWorktree, items);
  return { ok: true, task: input.id, ...saved };
}
