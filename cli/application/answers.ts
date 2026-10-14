import { type DecisionCard, getOpenCard, getOption } from "../../domain/build.ts";
import { noRunError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { tenboxDir } from "../../domain/task.ts";
import { isPlainObject } from "../../domain/utils.ts";
import { claudeSessions, type ResumableRun } from "../infra/claude/sessionFiles.ts";
import { files } from "../infra/files.ts";
import { builds } from "./builds.ts";
import { decisions } from "./decisions.ts";
import { sessions } from "./sessions.ts";

/** Answers: the option chosen on a decision card, and the build run resumed with it. */
export const answers = { save };

interface AnswerInput {
  id: TaskId;
  taskWorktree: string;
  /** The 1-based option of the card. */
  option: number;
}

export interface AnswerSaved {
  option: number;
  /** The run id of the resumed `tenbox-build` run. */
  run: string;
  /** The full id of the session that runs it again. */
  session: string;
}

/** What `/tenbox-build` gets in its args: only that round's worker of that part sees it. */
interface WorkflowAnswer {
  round: number;
  part: string;
  option: number;
  text: string;
}

const BUILD_WORKFLOW = "tenbox-build";

/**
 * Records the option in `decisions.md` and `build.json`, then resumes the last build run.
 * Checks the card, the option and the run first, so a refusal writes nothing; a failed resume
 * leaves the card open again.
 */
async function save(input: AnswerInput): Promise<AnswerSaved> {
  const { id, taskWorktree, option } = input;
  const result = await builds.find(tenboxDir(taskWorktree));
  const open = getOpenCard(result, id);
  const text = getOption(open.card, option);
  const cwd = await files.realPath(taskWorktree);
  const run = await claudeSessions.findLastRun(cwd, BUILD_WORKFLOW);
  if (run === null) throw noRunError(id);
  await decisions.save(taskWorktree, [{ answer: noteOf(open.card, option, text) }]);
  const answered = { option, at: new Date().toISOString(), auto: false };
  await builds.update(taskWorktree, { ...open.result, answered });
  const answer = { round: open.round, part: open.part, option, text };
  const prompt = resumePrompt(run, argsWithAnswer(run, id, answer));
  try {
    await sessions.resume({ id, taskWorktree }, { session: run.session, prompt });
  } catch (error) {
    // The card stays open, so the same answer can be given again; decisions.md keeps one line.
    await builds.update(taskWorktree, open.result);
    throw error;
  }
  return { option, run: run.runId, session: run.session };
}

/** One `decisions.md` line: the card title and the chosen option. */
const noteOf = (card: DecisionCard, option: number, text: string): string =>
  `${card.title} Answer: ${option}. ${text}`;

/** The run's own args plus the answer; a task id string becomes `{ task }`. */
function argsWithAnswer(run: ResumableRun, id: TaskId, answer: WorkflowAnswer): object {
  if (typeof run.args === "string") return { task: run.args, answer };
  const base = isPlainObject(run.args) ? run.args : { task: id };
  return { ...base, answer };
}

/** Same script and args up to the answer, so every earlier agent returns from the cache. */
function resumePrompt(run: ResumableRun, args: object): string {
  return [
    `Run the Workflow tool with scriptPath ${JSON.stringify(run.scriptPath)},`,
    `resumeFromRunId ${JSON.stringify(run.runId)} and these args: ${JSON.stringify(args)}`,
  ].join(" ");
}
