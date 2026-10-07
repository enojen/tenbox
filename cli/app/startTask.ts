import path from "node:path";
import { TenboxError } from "../domain/errors.ts";
import { type TaskId, taskBranch, tmuxSessionName } from "../domain/ids.ts";
import { EXCLUDED_PATHS, taskWorktreeDir } from "../domain/project.ts";
import type { SetupResult, StartResult } from "./results.ts";
import { type Task, renderTaskMd, tenboxDir } from "../domain/task.ts";
import type { Ports } from "../ports.ts";
import { findProject, loadManifest } from "./project.ts";

export interface StartInput {
  id: TaskId;
  /** With a title, no tracker is needed. */
  title?: string;
  base: string;
  tmux: boolean;
  setup: boolean;
}

/** Worktree + branch from `base`, `.tenbox/` with `task.md`, setup, tmux session with `claude`. */
export async function startTask(ports: Ports, input: StartInput): Promise<StartResult> {
  const { git, files, tmux, shell, env, log } = ports;
  const { id, base } = input;

  const project = await findProject(git, files, env.cwd);
  const manifest = await loadManifest(files, project.mainDir);
  const tracker = ports.tracker(manifest.tracker);

  const task: Task = input.title
    ? { id, title: input.title, description: "", url: "", status: "todo", tracker: "none" }
    : { ...(await tracker.getTask(id)), id, tracker: tracker.kind };

  const dir = taskWorktreeDir(env.wtRoot, project.name, id);
  const branch = taskBranch(manifest.names, id);
  let created = false;
  if (await files.isDir(dir)) {
    if ((await git.try(["rev-parse", "--show-toplevel"], dir)) !== dir) {
      throw new TenboxError(`${dir} exists but is not a git worktree`, "worktree");
    }
    log(`tenbox start: worktree ${dir} exists, reusing it`);
  } else {
    if ((await git.try(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], project.mainDir)) === null) {
      throw new TenboxError(`base branch ${base} not found; pass --base <branch>`, "no-base");
    }
    await files.mkdir(path.dirname(dir));
    const branchExists = (await git.try(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], project.mainDir)) !== null;
    await git.run(branchExists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, base], project.mainDir);
    created = true;
    log(`tenbox start: worktree ${dir} on ${branch} from ${base}`);
  }

  await git.ensureExcludes(project.commonDir, EXCLUDED_PATHS);

  const tb = tenboxDir(dir);
  await files.mkdir(path.join(tb, "tasks"));
  await files.mkdir(path.join(tb, "rounds"));
  const taskMd = path.join(tb, "task.md");
  if (!(await files.exists(taskMd))) await files.write(taskMd, renderTaskMd(task));

  // Subagent worktrees branch from HEAD, which inside the task worktree is feat/<id>.
  // Claude Code reads local settings from the main checkout, so the file lives there.
  const settingsFile = path.join(project.mainDir, ".claude", "settings.local.json");
  const settings = JSON.parse((await files.read(settingsFile)) ?? "{}") as Record<string, unknown>;
  const worktree = (settings.worktree ?? {}) as Record<string, unknown>;
  if (worktree.baseRef !== "head") {
    await files.write(settingsFile, `${JSON.stringify({ ...settings, worktree: { ...worktree, baseRef: "head" } }, null, 2)}\n`);
  }

  const setup = await runSetup(ports, dir, manifest.setup, input.setup);

  let trackerStatus = "skipped";
  if (!input.title) {
    try {
      await tracker.setStatus(id, "in_progress");
      trackerStatus = "in_progress";
    } catch (e) {
      trackerStatus = `failed: ${(e as Error).message}`;
    }
  }

  const session = tmuxSessionName(manifest.names, id);
  let tmuxState: StartResult["tmux"]["state"] = "skipped";
  if (input.tmux) {
    if (await tmux.hasSession(session)) tmuxState = "exists";
    else {
      const claude = env.which("claude");
      if (!claude) tmuxState = "unavailable";
      else {
        await tmux.newSession(session, dir, [claude]);
        tmuxState = "started";
      }
    }
    log(tmuxState === "unavailable" ? "tenbox start: claude not found in PATH, tmux session not started" : `tenbox start: tmux session ${session} ${tmuxState}`);
  }

  return {
    ok: true,
    task: id,
    title: task.title,
    project: project.name,
    worktree: dir,
    branch,
    base,
    created,
    task_md: taskMd,
    setup,
    tracker: { kind: tracker.kind, status: trackerStatus },
    tmux: { session, state: tmuxState, attach: `tmux attach -t ${session}` },
  };
}

async function runSetup(ports: Ports, dir: string, manifestSetup: string | undefined, wanted: boolean): Promise<SetupResult> {
  if (!wanted) return { state: "skipped", reason: "--no-setup" };
  const cmd = manifestSetup;
  if (!cmd) return { state: "skipped", reason: "no setup: in tenbox.yaml" };
  ports.log(`tenbox start: setup: ${cmd}`);
  const t0 = ports.clock.now().getTime();
  const r = await ports.shell.run(cmd, { cwd: dir, timeoutMs: 15 * 60_000 });
  const duration_ms = ports.clock.now().getTime() - t0;
  if (r.code !== 0) {
    throw new TenboxError(`setup failed (exit ${r.code}): ${cmd}`, "setup", { output: r.output.split("\n").slice(-30).join("\n") });
  }
  return { state: "ran", cmd, exit_code: r.code, duration_ms };
}
