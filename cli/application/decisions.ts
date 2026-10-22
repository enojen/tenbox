import {
  applyDecisions,
  type DecideItem,
  type Decision,
  decisionsFile,
  isDecisionTaken,
  type OptionsTaken,
  questionsFile,
  takeOptions,
} from "../../domain/decision.ts";
import { tenboxDir } from "../../domain/task.ts";
import { files } from "../infra/files.ts";
import { approvals } from "./approvals.ts";
import { plans } from "./plans.ts";

/**
 * Decisions: the answers in `.tenbox/decisions.md`, the ticks in `.tenbox/questions.md` and the
 * options taken on the plan decisions of `plan.json`.
 */
export const decisions = { save };

export interface DecisionsSaved {
  /** The path of `decisions.md`. */
  file: string;
  added: number;
  ticked: number;
}

/**
 * Writes nothing when a question fits other than one line (`unknown-question`), a decision other
 * than one title (`unknown-decision`), or `taken` is not an option (`bad-input`). A plan that
 * was approved is approved again, because the person who decides is the one who approves.
 */
async function save(taskWorktree: string, items: DecideItem[]): Promise<DecisionsSaved> {
  const dir = tenboxDir(taskWorktree);
  const taken = await takePlanOptions(dir, items);
  const answers = items.filter((item): item is Decision => !isDecisionTaken(item));
  const decisionsPath = decisionsFile(dir);
  const questionsPath = questionsFile(dir);
  const decisionsText = await readText(decisionsPath);
  const questionsText = await readText(questionsPath);
  const texts = { decisions: decisionsText, questions: questionsText };
  const applied = applyDecisions([...answers, ...(taken?.notes ?? [])], texts);
  if (taken) {
    await plans.update(dir, taken.plan);
    await approvals.update(dir);
  }
  if (applied.added > 0) await files.write(decisionsPath, applied.decisions);
  if (applied.ticked > 0) await files.write(questionsPath, applied.questions);
  return { file: decisionsPath, added: applied.added, ticked: applied.ticked };
}

/** The plan with the options taken; null when no item takes one. */
async function takePlanOptions(dir: string, items: DecideItem[]): Promise<OptionsTaken | null> {
  const takenItems = items.filter(isDecisionTaken);
  if (takenItems.length === 0) return null;
  const plan = await plans.get(dir);
  return takeOptions(plan, takenItems);
}

async function readText(file: string): Promise<string> {
  const text = await files.read(file);
  return text ?? "";
}
