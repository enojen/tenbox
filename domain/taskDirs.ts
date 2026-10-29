import path from "node:path";
import type { ProjectId, TaskId } from "./ids.ts";

/*
 * Every path under the Tenbox home. The readers and schemas of these files live in the file
 * of their concept: `readPlan` in plans.ts, `readBuild` in builds.ts.
 *
 * ~/.tenbox/<project id>/          projectDir
 *   project.json                   projectFile
 *   <id>/                          taskDir; `.tenbox` in the task worktree links here
 *     task.json  task.md           taskFile, taskMdFile
 *     plan.json  plan.md           planFile, planMdFile
 *     approved.json  build.json    approvedFile, buildFile
 *     proofs.json  stats.json      proofsFile, statsFile
 *     decisions.md  questions.md   decisionsFile, questionsFile
 *     override.yaml                overrideFile
 *     auto-answer.log              autoAnswerLog
 *     cards/                       cardsDir
 *       NNNN-<kind>.json           cardFile
 *       NNNN-<kind>.md             cardMdFile; only a task or plan card
 *     parts/                       partsDir
 *     rounds/<N>/                  roundDir
 *       checks.json                checksFile
 *       checks-full.json           checksFullFile
 *       checks/<name>.log          checkLogsDir, checkLogFile
 *     groups/<N>/                  groupDir; a group above 1
 *       group.json                 groupFile
 *       rounds/<N>/                roundDir: as above, the checks of that group
 */

/** `~/.tenbox/<project id>`: holds `project.json` and the task dirs. */
export function projectDir(tenboxHome: string, id: ProjectId): string {
  return path.join(tenboxHome, id);
}

/** `project.json` in a project's folder: its id and name. */
export const projectFile = (dir: string): string => path.join(dir, "project.json");

/** `~/.tenbox/<project id>/<id>`: the files of one task; `.tenbox` in its worktree links here. */
export function taskDir(tenboxHome: string, projectId: ProjectId, id: TaskId): string {
  return path.join(projectDir(tenboxHome, projectId), id);
}

/** `.tenbox` in a task worktree: the link to its task dir. */
export const tenboxDir = (taskWorktree: string): string => path.join(taskWorktree, ".tenbox");

/** `task.json` in a `.tenbox/` folder: the task as `tenbox start` saw it. */
export const taskFile = (dir: string): string => path.join(dir, "task.json");
/** `task.md` in a `.tenbox/` folder. */
export const taskMdFile = (dir: string): string => path.join(dir, "task.md");
/** `plan.json` in a `.tenbox/` folder: the validated planner result. */
export const planFile = (dir: string): string => path.join(dir, "plan.json");
/** `plan.md` in a `.tenbox/` folder. */
export const planMdFile = (dir: string): string => path.join(dir, "plan.md");
/** `approved.json` in a `.tenbox/` folder: the `Approval`. */
export const approvedFile = (dir: string): string => path.join(dir, "approved.json");
/** `build.json` in a `.tenbox/` folder: the last build result. */
export const buildFile = (dir: string): string => path.join(dir, "build.json");
/** `proofs.json` in a `.tenbox/` folder. */
export const proofsFile = (dir: string): string => path.join(dir, "proofs.json");
/** `stats.json` in a task dir. */
export const statsFile = (dir: string): string => path.join(dir, "stats.json");
/** `decisions.md` in a `.tenbox/` folder. */
export const decisionsFile = (dir: string): string => path.join(dir, "decisions.md");
/** `questions.md` in a `.tenbox/` folder. */
export const questionsFile = (dir: string): string => path.join(dir, "questions.md");
/** `override.yaml` in a `.tenbox/` folder: the last manifest layer. */
export const overrideFile = (dir: string): string => path.join(dir, "override.yaml");
/** `auto-answer.log` in a `.tenbox/` folder: the output of the background `tenbox answer --auto`. */
export const autoAnswerLog = (dir: string): string => path.join(dir, "auto-answer.log");
/** `cards/` in a `.tenbox/` folder: every card of the task. */
export const cardsDir = (dir: string): string => path.join(dir, "cards");

/** The id and kind of a card: what names its files. */
export interface CardName {
  id: number;
  kind: string;
}

/** Four digits keep the files in card order: `0001-task`. */
const CARD_ID_DIGITS = 4;

/** `cards/<NNNN>-<kind>.json`: what the code reads of a card. */
export const cardFile = (cards: string, card: CardName): string =>
  path.join(cards, `${cardName(card)}.json`);
/** `cards/<NNNN>-<kind>.md`: the long text of a task or plan card. */
export const cardMdFile = (cards: string, card: CardName): string =>
  path.join(cards, `${cardName(card)}.md`);

function cardName(card: CardName): string {
  return `${String(card.id).padStart(CARD_ID_DIGITS, "0")}-${card.kind}`;
}

/** `parts/` in a `.tenbox/` folder. */
export const partsDir = (dir: string): string => path.join(dir, "parts");
/** `rounds/` in a `.tenbox/` folder. */
export const roundsDir = (dir: string): string => path.join(dir, "rounds");

/** `rounds/<N>` in a `.tenbox/` folder. */
export const roundDir = (dir: string, round: number): string =>
  path.join(roundsDir(dir), String(round));
/** `checks.json` in a round directory. */
export const checksFile = (round: string): string => path.join(round, "checks.json");
/** `checks-full.json` in a round directory: the result of the `full` tier. */
export const checksFullFile = (round: string): string => path.join(round, "checks-full.json");
/** `checks/` in a round directory: one log per check. */
export const checkLogsDir = (round: string): string => path.join(round, "checks");
/** `checks/<name>.log` in a round directory: the output of one check. */
export const checkLogFile = (round: string, check: string): string =>
  path.join(checkLogsDir(round), `${check}.log`);

/** `groups/<N>` in a `.tenbox/` folder. */
export const groupDir = (dir: string, group: number): string =>
  path.join(dir, "groups", String(group));
/** `group.json` in a group folder. */
export const groupFile = (dir: string): string => path.join(dir, "group.json");
/** The folder that holds a group's rounds: `.tenbox` for group 1, `groups/<N>` above it. */
export const groupRoot = (taskWorktree: string, group: number): string =>
  group === 1 ? tenboxDir(taskWorktree) : groupDir(tenboxDir(taskWorktree), group);
