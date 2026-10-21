import {
  assertKindFits,
  BUILD_STATUS,
  type BuildResult,
  buildArgs,
  buildKind,
  groupTiers,
  type KindPlan,
  parseBuild,
  uniqueFiles,
} from "../../domain/build.ts";
import type { ChangedFile } from "../../domain/changedFile.ts";
import { checkFailedError } from "../../domain/errors/tasks.ts";
import { sessionName, type TaskId, taskBranch } from "../../domain/ids.ts";
import { CHECK_TIER, type Manifest } from "../../domain/manifest.ts";
import { NOTIFICATION_STATE, notificationStateOf } from "../../domain/notifications.ts";
import type { PlanResult } from "../../domain/plan.ts";
import { checksOk, checksSummary } from "../../domain/pr.ts";
import { groupBranch, groupWorktreeDir, tenboxDir } from "../../domain/task.ts";
import { errorMessage, MS_PER_SECOND } from "../../domain/utils.ts";
import { approvals } from "../application/approvals.ts";
import { autoAnswers } from "../application/autoAnswers.ts";
import { builds } from "../application/builds.ts";
import { notifications, type TaskNotification } from "../application/notifications.ts";
import { plans } from "../application/plans.ts";
import { projects } from "../application/projects.ts";
import { sessions } from "../application/sessions.ts";
import { tasks } from "../application/tasks.ts";
import { worktrees } from "../application/worktrees/index.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { runChecks } from "./check.ts";
import { assertChecked, latestChecksText, openPr } from "./pr.ts";
import type { PrError, PrResult, SendBuildResult, TaskFileResult } from "./results.ts";

/**
 * Checks the approval, then starts `claude --bg` in the task worktree with `/tenbox-build` and
 * the build args of `plan.json`: its kind applied to the lenses and group recipes.
 */
export async function sendBuild(id: TaskId): Promise<SendBuildResult> {
  const taskWorktree = await worktrees.get(id);
  await approvals.get(taskWorktree, id);
  const { manifest } = await projects.get(taskWorktree);
  const taskDir = await files.realPath(tenboxDir(taskWorktree));
  const plan = await plans.get(taskDir);
  const sent = `/tenbox-build ${JSON.stringify(buildArgs({ task: id, plan }))}`;
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
 * Validates the build result and writes it with its kind to the task's `.tenbox/build.json`. A
 * `ready-for-you` result must pass its checks and fit the limits of its kind before anything is
 * written, and then opens the draft PR.
 */
export async function buildDone(input: BuildDoneInput): Promise<BuildDoneResult> {
  const { id } = input;
  const taskWorktree = await worktrees.get(id);
  const result = parseBuild(input.json);
  const plan = await plans.find(tenboxDir(taskWorktree));
  const kindPlan: KindPlan = { plan, kind: buildKind({ result, plan }) };
  const ready = result.status === BUILD_STATUS.readyForYou;
  if (ready) await assertChecksPass({ id, taskWorktree, kindPlan });
  if (ready) await assertDiffFits({ id, taskWorktree, kindPlan });
  const file = await builds.save(taskWorktree, JSON.stringify({ ...result, kind: kindPlan.kind }));
  await saveBuildStatus(taskWorktree);
  await notifyEnd(id, taskWorktree);
  await autoAnswers.run({ id, taskWorktree });
  if (!ready) return { ok: true, task: id, file };
  const pr = await openDraftPr(id);
  return { ok: true, task: id, file, pr };
}

/** The task, its worktree, and its plan with the kind the build runs as. */
interface KindCheck {
  id: TaskId;
  taskWorktree: string;
  kindPlan: KindPlan;
}

/**
 * Each group's latest checks ran green at its HEAD, then its full tier passes when its recipe,
 * with the kind applied, asks for it.
 */
async function assertChecksPass(check: KindCheck): Promise<void> {
  const { id, taskWorktree, kindPlan } = check;
  for (const { group, tier } of groupTiers(kindPlan)) {
    await assertFastGreen({ id, taskWorktree, group });
    if (tier === CHECK_TIER.full) await assertFullGreen({ id, taskWorktree, group });
  }
}

/** `kind-raised` when the diff of every group branch is over the limits of the build's kind. */
async function assertDiffFits(check: KindCheck): Promise<void> {
  const { id, taskWorktree, kindPlan } = check;
  const { manifest } = await projects.get(taskWorktree);
  const diff = await listTaskDiff({ id, taskWorktree, plan: kindPlan.plan, manifest });
  assertKindFits({ ...kindPlan, files: diff });
}

interface TaskDiffInput {
  id: TaskId;
  taskWorktree: string;
  plan: PlanResult | null;
  manifest: Manifest;
}

/** What the group branches changed against the base, generated files out, each path once. */
async function listTaskDiff(input: TaskDiffInput): Promise<ChangedFile[]> {
  const { id, taskWorktree, plan, manifest } = input;
  const branch = taskBranch(manifest.names, id);
  const groupIds = plan?.groups?.map((group) => group.id) ?? [1];
  const branches = groupIds.map((group) => (group === 1 ? branch : groupBranch(branch, group)));
  const diffs: ChangedFile[][] = [];
  for (const groupBranchName of branches) {
    const diff = await listBranchDiff({
      taskWorktree,
      base: manifest.base,
      branch: groupBranchName,
    });
    diffs.push(diff);
  }
  return uniqueFiles(diffs);
}

interface BranchDiffInput {
  taskWorktree: string;
  base: string;
  branch: string;
}

/** What the branch changed since it left the base, without generated files; empty without it. */
async function listBranchDiff(input: BranchDiffInput): Promise<ChangedFile[]> {
  const { taskWorktree, base, branch } = input;
  const exists = await git.branchExists(taskWorktree, branch);
  if (!exists) return [];
  const changed = await git.listChangedFiles(taskWorktree, base, branch);
  const paths = changed.map((file) => file.path);
  const generated = await git.listGeneratedFiles(taskWorktree, paths);
  return changed.filter((file) => !generated.includes(file.path));
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

/** The status of the saved build result becomes the task state. */
async function saveBuildStatus(taskWorktree: string): Promise<void> {
  const dir = tenboxDir(taskWorktree);
  const result = await builds.find(dir);
  if (result !== null) await tasks.saveStatus(dir, result.status);
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
