import { describe, expect, test } from "bun:test";
import { taskId } from "../domain/ids.ts";
import { fakePorts } from "../test/fakes.ts";
import { startTask } from "./startTask.ts";

const MAIN = "/wt/demo/main";
const TASK = "/wt/demo/T-1";
const SHA = "a".repeat(40);

function ports(overrides: { worktreeExists?: boolean } = {}) {
  let worktreeExists = overrides.worktreeExists ?? false;
  const p = fakePorts({
    cwd: MAIN,
    wtRoot: "/wt",
    git: (args, cwd) => {
      const a = args.join(" ");
      if (a === "rev-parse --git-common-dir") return `${MAIN}/.git`;
      if (a === "rev-parse --show-toplevel") return cwd === TASK ? TASK : MAIN;
      if (a === "rev-parse --verify --quiet main^{commit}") return SHA;
      if (a === "rev-parse --verify --quiet refs/heads/feat/T-1") return null;
      if (a.startsWith("worktree add")) {
        worktreeExists = true;
        return "";
      }
      return null;
    },
    shell: (command) => ({ code: command.includes("fail") ? 1 : 0, output: `ran ${command}\n`, timedOut: false }),
  });
  p.files.seed({ [`${MAIN}/tenbox.yaml`]: "project: demo\nsetup: bun install\n" });
  if (worktreeExists) p.files.dirs.add(TASK);
  const origIsDir = p.files.isDir.bind(p.files);
  p.files.isDir = async (d) => (d === TASK ? worktreeExists : origIsDir(d));
  return p;
}

describe("startTask", () => {
  test("creates the worktree, .tenbox, excludes, settings, setup and tmux", async () => {
    const p = ports();
    const r = await startTask(p, { id: taskId("T-1"), title: "Cancel", base: "main", tmux: true, setup: true });
    expect(r.created).toBe(true);
    expect(r.worktree).toBe(TASK);
    expect(p.git.calls.some((c) => c.args.join(" ") === `worktree add -b feat/T-1 ${TASK} main` && c.cwd === MAIN)).toBe(true);
    expect(await p.files.read(`${TASK}/.tenbox/task.md`)).toContain("# T-1 · Cancel");
    expect(p.git.excludes).toEqual([{ commonDir: `${MAIN}/.git`, patterns: [".tenbox/", ".claude/worktrees/", ".claude/settings.local.json"] }]);
    expect(JSON.parse((await p.files.read(`${MAIN}/.claude/settings.local.json`))!)).toEqual({ worktree: { baseRef: "head" } });
    expect(r.setup).toMatchObject({ state: "ran", cmd: "bun install" });
    expect(p.shell.calls).toEqual([{ command: "bun install", cwd: TASK }]);
    expect(p.tmux.sessions.get("tenbox-T-1")).toEqual({ cwd: TASK, command: ["/usr/bin/claude"] });
    expect(r.tmux.state).toBe("started");
    expect(r.tracker).toEqual({ kind: "none", status: "skipped" });
  });

  test("reuses an existing worktree and keeps task.md and settings", async () => {
    const p = ports({ worktreeExists: true });
    p.files.put(`${TASK}/.tenbox/task.md`, "# T-1 · Old title\n");
    p.files.put(`${MAIN}/.claude/settings.local.json`, '{"worktree":{"baseRef":"head"},"permissions":{"allow":["Bash(git:*)"]}}');
    p.tmux.sessions.set("tenbox-T-1", { cwd: TASK, command: [] });
    const r = await startTask(p, { id: taskId("T-1"), title: "Cancel", base: "main", tmux: true, setup: false });
    expect(r.created).toBe(false);
    expect(await p.files.read(`${TASK}/.tenbox/task.md`)).toBe("# T-1 · Old title\n");
    expect(JSON.parse((await p.files.read(`${MAIN}/.claude/settings.local.json`))!).permissions).toEqual({ allow: ["Bash(git:*)"] });
    expect(r.setup).toEqual({ state: "skipped", reason: "--no-setup" });
    expect(r.tmux.state).toBe("exists");
    expect(p.git.calls.some((c) => c.args[0] === "worktree")).toBe(false);
  });

  test("without a title and without a tracker it fails with no-tracker", async () => {
    const p = ports();
    await expect(startTask(p, { id: taskId("T-1"), base: "main", tmux: false, setup: false })).rejects.toMatchObject({ code: "no-tracker" });
  });

  test("a failing setup is an error with the output tail", async () => {
    const p = ports();
    p.files.put(`${MAIN}/tenbox.yaml`, "project: demo\nsetup: fail now\n");
    await expect(startTask(p, { id: taskId("T-1"), title: "x", base: "main", tmux: false, setup: true })).rejects.toMatchObject({ code: "setup" });
  });
});
