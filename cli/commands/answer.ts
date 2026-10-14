import type { TaskId } from "../../domain/ids.ts";
import { answers } from "../application/answers.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { AnswerResult } from "./results.ts";

export interface AnswerCardInput {
  id: TaskId;
  /** The 1-based option of the decision card. */
  option: number;
}

/** Answers the decision card in `build.json` and resumes the build run that asked it. */
export async function answerCard(input: AnswerCardInput): Promise<AnswerResult> {
  const taskWorktree = await worktrees.get(input.id);
  const saved = await answers.save({ id: input.id, taskWorktree, option: input.option });
  return { ok: true, task: input.id, ...saved };
}
