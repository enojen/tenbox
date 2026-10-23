import { type AutoCard, autoCardOf } from "../../domain/answers.ts";
import { autoAnswerLog, tenboxDir } from "../../domain/taskDirs.ts";
import { log } from "../infra/env.ts";
import { pollUntil } from "../infra/poll.ts";
import { processes } from "../infra/processes.ts";
import { type AnswerSaved, type AnswerTarget, answers } from "./answers.ts";
import { builds } from "./builds.ts";

/** Automatic continue: the recommended option, once a card's deadline passed with no answer. */
export const autoAnswers = { run, save };

/** One card being watched in a `.tenbox` dir. */
interface CardWatch {
  dir: string;
  card: AutoCard;
}

/** `tenbox build done`: an open `auto` card starts `tenbox answer <id> --auto` in the background. */
async function run(target: AnswerTarget): Promise<void> {
  const card = await findCard(tenboxDir(target.taskWorktree));
  if (card === null) return;
  const logFile = autoAnswerLog(tenboxDir(target.taskWorktree));
  const args = ["answer", target.id, "--auto"];
  processes.runSelf({ args, cwd: target.taskWorktree, logFile });
}

/**
 * Waits for the deadline of the open `auto` card, then answers with its recommended option.
 * Null when there is no such card, or when it is answered or replaced before the deadline; it
 * looks once a second, so it ends soon after a person answers.
 */
async function save(target: AnswerTarget): Promise<AnswerSaved | null> {
  const dir = tenboxDir(target.taskWorktree);
  const card = await findCard(dir);
  if (card === null) return null;
  log(`tenbox answer ${target.id} --auto: waits until ${card.deadline}`);
  const check = () => findChange({ dir, card });
  const changed = await pollUntil({ check, deadlineMs: Date.parse(card.deadline) });
  if (changed !== null) return null;
  return answers.save({ ...target, option: card.recommended, auto: true });
}

/** True once the watched card is no longer the open `auto` card: answered, replaced or gone. */
async function findChange(watch: CardWatch): Promise<true | null> {
  const current = await findCard(watch.dir);
  return current?.deadline === watch.card.deadline ? null : true;
}

async function findCard(dir: string): Promise<AutoCard | null> {
  const result = await builds.find(dir);
  return autoCardOf(result);
}
