import { answerNote, argsWithAnswer, getOpenCard } from "../../domain/answers.ts";
import { getOption } from "../../domain/cards.ts";
import { COMMAND } from "../../domain/commands.ts";
import { noRunError } from "../../domain/errors/tasks.ts";
import type { TaskId } from "../../domain/ids.ts";
import { answerLog, tenboxDir } from "../../domain/taskDirs.ts";
import { TASK_STATE } from "../../domain/tasks.ts";
import { resumePrompt } from "../infra/claude/background.ts";
import { claudeSessions, type ResumableRun } from "../infra/claude/sessionFiles.ts";
import { files } from "../infra/files.ts";
import { processes } from "../infra/processes.ts";
import { builds } from "./builds.ts";
import { decisions } from "./decisions.ts";
import { sessions } from "./sessions.ts";
import { tasks } from "./tasks.ts";

/** Answers: the option chosen on a decision card, and the build run resumed with it. */
export const answers = { save };

/** The card of one task worktree. */
export interface AnswerTarget {
  id: TaskId;
  taskWorktree: string;
}

interface AnswerInput extends AnswerTarget {
  /** The 1-based option of the card. */
  option: number;
  /** True when no person chose it: the deadline passed. */
  auto: boolean;
}

export interface AnswerSaved {
  option: number;
  /** The run id of the resumed `tenbox-build` run. */
  run: string;
  /** The full id of the session that runs it again. */
  session: string;
  /** Set when a tenbox of its own answers: its log file. */
  log?: string;
}

const BUILD_WORKFLOW = "tenbox-build";

/**
 * Records the option in `decisions.md` and `build.json`, then resumes the last build run.
 * Checks the card, the option and the run first, so a refusal writes nothing; a failed resume
 * leaves the card open again.
 */
async function save(input: AnswerInput): Promise<AnswerSaved> {
  const { id, taskWorktree, option, auto } = input;
  const result = await builds.find(tenboxDir(taskWorktree));
  const open = getOpenCard(result, id);
  const text = getOption(open.card, option);
  const cwd = await files.realPath(taskWorktree);
  const run = await claudeSessions.findLastRun(cwd, BUILD_WORKFLOW);
  if (run === null) throw noRunError(id);
  const current = await sessions.findCurrent({ id, taskWorktree });
  if (current !== null) return answerOutsideSession(input, run);
  const note = answerNote({ card: open.card, option, text, auto });
  await decisions.save(taskWorktree, [{ answer: note }]);
  const answered = { option, at: new Date().toISOString(), auto };
  await builds.update(taskWorktree, { ...open.result, answered });
  const answer = { round: open.round, part: open.part, option, text };
  const prompt = resumePrompt(run, argsWithAnswer({ id, runArgs: run.args, answer }));
  try {
    await sessions.resume({ id, taskWorktree }, { session: run.session, prompt });
  } catch (error) {
    // The card stays open, so the same answer can be given again; decisions.md keeps one line.
    await builds.update(taskWorktree, open.result);
    throw error;
  }
  await tasks.saveStatus(tenboxDir(taskWorktree), TASK_STATE.building);
  return { option, run: run.runId, session: run.session };
}

/** `sessions.resume` stops the task's sessions, so one of them cannot run it and go on. */
function answerOutsideSession(input: AnswerInput, run: ResumableRun): AnswerSaved {
  const { id, taskWorktree, option } = input;
  const log = answerLog(tenboxDir(taskWorktree));
  const args = [COMMAND.answer, id, String(option)];
  processes.runSelf({ args, cwd: taskWorktree, logFile: log });
  return { option, run: run.runId, session: run.session, log };
}
