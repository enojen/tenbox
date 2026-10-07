import path from "node:path";
import { type Baseline, compareWithBaseline, parseFailures } from "../domain/failures.ts";
import { TenboxError } from "../domain/errors.ts";
import type { TaskId } from "../domain/ids.ts";
import type { Project } from "../domain/project.ts";
import { nextRound, roundDir, tenboxDir } from "../domain/task.ts";
import type { BaselineStore, Ports } from "../ports.ts";
import { findProject, loadManifest, resolveTaskDir } from "./project.ts";
import type { CheckResult, CheckRun } from "./results.ts";

export interface CheckInput {
  id: TaskId;
  round?: number;
  base: string;
  timeoutMs: number;
}

interface BaselineHit extends Baseline {
  source: CheckRun["baseline"]["source"];
}

/**
 * Runs every check in the task worktree and keeps only failures the base commit did
 * not already have: the devbox `wtbase` algorithm. Writes `.tenbox/rounds/N/checks.json`.
 */
export async function runChecks(ports: Ports, input: CheckInput): Promise<CheckResult> {
  const { git, files, shell, baselines, env, log } = ports;
  const { id, base, timeoutMs } = input;

  const taskDir = await resolveTaskDir(ports, id);
  const project = await findProject(git, files, taskDir);
  const manifest = await loadManifest(files, project.mainDir, taskDir);
  const checks = requireChecks(manifest.checks);
  const pattern = manifest.failure_pattern ?? env.failurePattern;

  const round = input.round ?? nextRound(await files.list(path.join(tenboxDir(taskDir), "rounds")));
  const rdir = roundDir(taskDir, round);
  await files.mkdir(path.join(rdir, "checks"));

  const head = (await git.try(["rev-parse", "HEAD"], taskDir)) ?? "unknown";
  const baseSha = (await git.try(["merge-base", "HEAD", base], taskDir)) ?? head;
  const mainHead = await git.try(["rev-parse", "HEAD"], project.mainDir);

  const results: CheckRun[] = [];
  for (const [name, cmd] of Object.entries(checks)) {
    log(`tenbox check: ${name}: ${cmd}`);
    const t0 = performance.now();
    const r = await shell.run(cmd, { cwd: taskDir, timeoutMs });
    const duration_ms = Math.round(performance.now() - t0);
    const logFile = path.join(rdir, "checks", `${name}.log`);
    await files.write(logFile, r.output);
    const current = parseFailures(r.output, r.timedOut ? 124 : r.code, pattern);

    let hit = await pickBaseline(baselines, project.name, name, baseSha);
    if (!hit && mainHead === baseSha && project.mainDir !== taskDir) {
      log(`tenbox check: ${name}: no baseline for ${baseSha.slice(0, 7)}, taking one in ${project.mainDir}`);
      hit = await takeBaseline(ports, project, name, cmd, baseSha, timeoutMs, pattern);
    }
    const baseLines = hit?.lines ?? [];
    const { newFailures, fixed } = compareWithBaseline(baseLines, current);
    log(`tenbox check: ${name}: ${current.length} failures, ${newFailures.length} new, ${fixed.length} fixed (${duration_ms} ms)`);
    results.push({
      name,
      cmd,
      exit_code: r.code,
      duration_ms,
      timed_out: r.timedOut,
      failures: current.length,
      new_failures: newFailures,
      fixed,
      baseline: { sha: hit?.sha ?? baseSha, source: hit?.source ?? "none", failures: baseLines.length },
      log: path.relative(taskDir, logFile),
    });
  }

  const failing = results.filter((r) => r.new_failures.length > 0);
  const summary = failing.length
    ? failing.map((r) => `${r.name}: ${r.new_failures.length} new failure(s)\n${r.new_failures.map((l) => `  ${l}`).join("\n")}`).join("\n")
    : `all ${results.length} check(s) pass with no new failures`;

  const result: CheckResult = {
    ok: failing.length === 0,
    task: id,
    round,
    worktree: taskDir,
    commit: head,
    base: { ref: base, sha: baseSha },
    checks: results,
    summary,
    file: path.relative(taskDir, path.join(rdir, "checks.json")),
  };
  await files.write(path.join(rdir, "checks.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/** Tenbox runs only what the manifest says; it does not guess from the project. */
function requireChecks(checks: Record<string, string>): Record<string, string> {
  if (Object.keys(checks).length === 0) throw new TenboxError("no checks: in tenbox.yaml; add one", "no-checks");
  return checks;
}

/** The baseline for this sha, else the newest one for the check. */
async function pickBaseline(store: BaselineStore, project: string, check: string, sha: string): Promise<BaselineHit | null> {
  const exact = await store.find(project, check, sha);
  if (exact) return { ...exact, source: "exact" };
  const newest = await store.newest(project, check);
  return newest ? { ...newest, source: "newest" } : null;
}

/** Run the check in the main checkout, which sits at the base commit, and save the result. */
async function takeBaseline(ports: Ports, project: Project, check: string, cmd: string, sha: string, timeoutMs: number, pattern: string): Promise<BaselineHit> {
  const { shell, baselines, clock } = ports;
  const r = await shell.run(cmd, { cwd: project.mainDir, timeoutMs });
  const lines = parseFailures(r.output, r.timedOut ? 124 : r.code, pattern);
  await baselines.save(project.name, check, { sha, lines }, { date: clock.now().toISOString(), cmd, exit_code: r.code });
  return { sha, lines, source: "main" };
}
