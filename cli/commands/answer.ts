import { AUTO_ANSWER_STATE } from "../../domain/answers.ts";
import type { TaskId } from "../../domain/ids.ts";
import { answers } from "../application/answers.ts";
import { autoAnswers } from "../application/autoAnswers.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { AnswerResult, AutoAnswerResult } from "./results.ts";

export interface AnswerCardInput {
  id: TaskId;
  /** The 1-based option of the decision card. */
  option: number;
}

/** Answers the decision card in `build.json` and resumes the build run that asked it. */
export async function answerCard(input: AnswerCardInput): Promise<AnswerResult> {
  const taskWorktree = await worktrees.get(input.id);
  const saved = await answers.save({
    id: input.id,
    taskWorktree,
    option: input.option,
    auto: false,
  });
  return { ok: true, task: input.id, ...saved };
}

/** `--auto`: answers with the recommended option once the card's deadline passed. */
export async function answerWhenDue(id: TaskId): Promise<AutoAnswerResult> {
  const taskWorktree = await worktrees.get(id);
  const saved = await autoAnswers.save({ id, taskWorktree });
  if (saved === null) return { ok: true, task: id, state: AUTO_ANSWER_STATE.skipped };
  return { ok: true, task: id, state: AUTO_ANSWER_STATE.answered, ...saved };
}
