import { BUILD_STATUS, type BuildResult, parseBuild } from "../../domain/build.ts";
import { checkFailedError } from "../../domain/errors/tasks.ts";
import { sessionName, type TaskId } from "../../domain/ids.ts";
import { CHECK_TIER } from "../../domain/manifest.ts";
import { NOTIFICATION_STATE, notificationStateOf } from "../../domain/notifications.ts";
import type { PlanResult } from "../../domain/plan.ts";
import { checksOk, checksSummary } from "../../domain/pr.ts";
import { groupWorktreeDir, tenboxDir } from "../../domain/task.ts";
import { errorMessage, MS_PER_SECOND } from "../../domain/utils.ts";
import { approvals } from "../application/approvals.ts";
import { autoAnswers } from "../application/autoAnswers.ts";
import { builds } from "../application/builds.ts";
import { notifications, type TaskNotification } from "../application/notifications.ts";
import { plans } from "../application/plans.ts";
import { projects } from "../application/projects.ts";
import { sessions } from "../application/sessions.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { files } from "../infra/files.ts";
import { runChecks } from "./check.ts";
import { assertChecked, latestChecksText, openPr } from "./pr.ts";
import type { PrError, PrResult, SendBuildResult, TaskFileResult } from "./results.ts";

/**
 * Checks the approval, then starts `claude --bg` in the task worktree with `/tenbox-build` and
 * the task, parts, lenses and groups of `plan.json` as JSON args.
 */
export async function sendBuild(id: TaskId): Promise<SendBuildResult> {
  const taskWorktree = await worktrees.get(id);
  await approvals.get(taskWorktree, id);
  const { manifest } = await projects.get(taskWorktree);
  const taskDir = await files.realPath(tenboxDir(taskWorktree));
  const { parts, lenses, groups } = await plans.get(taskDir);
  const sent = `/tenbox-build ${JSON.stringify({ task: id, parts, lenses, ...(groups && { groups }) })}`;
  const start = {
    id,
    model: manifest.model,
    addDir: taskDir,
    name: sessionName(manifest.names, id),
    prompt: sent,
  };
  await sessions.run({ id, taskWorktree }, start);
  return { ok: true, task: id, sent };
}

export interface BuildDoneInput {
  id: TaskId;
  /** The build result as JSON text. */
  json: string;
}

/** `pr` only for an accepted `ready-for-you`: the draft PR result, or why it failed. */
export interface BuildDoneResult extends TaskFileResult {
  pr?: PrResult | PrError;
}

/** One group of the task whose checks `build done` verifies. */
interface GroupCheck {
  id: TaskId;
  taskWorktree: string;
  group: number;
}

/** As `tenbox check` without `--timeout`. */
const FULL_TIER_TIMEOUT_SECONDS = 600;
const FULL_TIER_TIMEOUT_MS = FULL_TIER_TIMEOUT_SECONDS * MS_PER_SECOND;

/**
 * Validates the build result and writes it to the task's `.tenbox/build.json`. A `ready-for-you`
 * result must pass its checks before anything is written, and then opens the draft PR.
 */
export async function buildDone(input: BuildDoneInput): Promise<BuildDoneResult> {
  const { id } = input;
  const taskWorktree = await worktrees.get(id);
  const ready = parseBuild(input.json).status === BUILD_STATUS.readyForYou;
  if (ready) await assertChecksPass(id, taskWorktree);
  const file = await builds.save(taskWorktree, input.json);
  await notifyEnd(id, taskWorktree);
  await autoAnswers.run({ id, taskWorktree });
  if (!ready) return { ok: true, task: id, file };
  const pr = await openDraftPr(id);
  return { ok: true, task: id, file, pr };
}

/**
 * Each group's latest checks ran green at its HEAD, then its full tier passes when its recipe asks
 * for it. A plan without groups is group 1 with the full tier.
 */
async function assertChecksPass(id: TaskId, taskWorktree: string): Promise<void> {
  const plan = await plans.find(tenboxDir(taskWorktree));
  for (const { group, full } of groupTiers(plan)) {
    await assertFastGreen({ id, taskWorktree, group });
    if (full) await assertFullGreen({ id, taskWorktree, group });
  }
}

/** One group and whether its recipe's check tier is `full`. */
interface GroupTier {
  group: number;
  full: boolean;
}

function groupTiers(plan: PlanResult | null): GroupTier[] {
  if (!plan?.groups) return [{ group: 1, full: true }];
  return plan.groups.map((g) => ({ group: g.id, full: g.recipe.tier === CHECK_TIER.full }));
}

async function assertFastGreen(check: GroupCheck): Promise<void> {
  const { id, taskWorktree, group } = check;
  const dir = group === 1 ? taskWorktree : groupWorktreeDir(taskWorktree, group);
  await assertChecked({ id, group, dir, taskWorktree });
  const text = await latestChecksText(taskWorktree, group);
  if (checksOk(text)) return;
  const summary = checksSummary(text) ?? "no summary";
  throw checkFailedError({ id, group, tier: CHECK_TIER.fast, summary });
}

/** Runs the full tier in the group's current round. */
async function assertFullGreen(check: GroupCheck): Promise<void> {
  const { id, group } = check;
  const tier = CHECK_TIER.full;
  const checkInput = { id, group, round: undefined, tier, base: undefined };
  const result = await runChecks({ ...checkInput, timeoutMs: FULL_TIER_TIMEOUT_MS });
  if (result.ok) return;
  throw checkFailedError({ id, group, tier, summary: result.summary });
}

/** No CI wait, as a person reviews the draft first. */
async function openDraftPr(id: TaskId): Promise<PrResult | PrError> {
  try {
    return await openPr({ id, ready: false, force: false, wait: false });
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** One line for an end status a person must act on; `not-approved` sends none. */
async function notifyEnd(id: TaskId, taskWorktree: string): Promise<void> {
  const result = await builds.find(tenboxDir(taskWorktree));
  if (result === null) return;
  const state = notificationStateOf(result.status);
  if (state === null) return;
  const card = state === NOTIFICATION_STATE.needsYou ? result.decision : undefined;
  const counts = state === NOTIFICATION_STATE.readyForYou ? readyDetail(result) : undefined;
  const notification: TaskNotification = {
    id,
    state,
    ...(card && { detail: card.title, recommended: card.recommended }),
    ...(counts && { detail: counts }),
  };
  await notifications.send({ taskWorktree, notification });
}

function readyDetail(result: BuildResult): string {
  const { round, attention, nice_to_have: niceToHave, unproven } = result;
  return `round ${round}, attention ${attention.length}, nice-to-have ${niceToHave.length}, unproven ${unproven.length}`;
}
