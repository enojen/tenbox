import {
  applyDecisions,
  type Decision,
  decisionsFile,
  questionsFile,
} from "../../domain/decision.ts";
import { tenboxDir } from "../../domain/task.ts";
import { files } from "../infra/files.ts";

/** Decisions: the answers in `.tenbox/decisions.md` and the ticks in `.tenbox/questions.md`. */
export const decisions = { save };

export interface DecisionsSaved {
  /** The path of `decisions.md`. */
  file: string;
  added: number;
  ticked: number;
}

/** Writes nothing when a question fits other than one line (`unknown-question`). */
async function save(taskWorktree: string, items: Decision[]): Promise<DecisionsSaved> {
  const dir = tenboxDir(taskWorktree);
  const decisionsPath = decisionsFile(dir);
  const questionsPath = questionsFile(dir);
  const decisionsText = await readText(decisionsPath);
  const questionsText = await readText(questionsPath);
  const applied = applyDecisions(items, { decisions: decisionsText, questions: questionsText });
  if (applied.added > 0) await files.write(decisionsPath, applied.decisions);
  if (applied.ticked > 0) await files.write(questionsPath, applied.questions);
  return { file: decisionsPath, added: applied.added, ticked: applied.ticked };
}

async function readText(file: string): Promise<string> {
  const text = await files.read(file);
  return text ?? "";
}
