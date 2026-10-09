import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { install } from "./install.ts";

let project: TempProject;

beforeEach(async () => {
  project = await makeTempProject({});
});

afterEach(async () => {
  await project.remove();
});

/** The main checkout of the Tenbox repo this test runs in; install links from there. */
async function sourceRoot(): Promise<string> {
  const mainDir = await git.findMainDir(env().tenboxRoot);
  if (mainDir === null) throw new Error("the tests run outside a git checkout");
  return mainDir;
}

async function sourceNames(dir: string): Promise<string[]> {
  const root = await sourceRoot();
  const names = await files.list(path.join(root, dir));
  return names.filter((name) => !name.startsWith(".")).sort();
}

interface AgentPair {
  agentA: string;
  agentB: string;
}

async function twoAgents(): Promise<AgentPair> {
  const [agentA, agentB] = await sourceNames("agents");
  if (agentA === undefined || agentB === undefined) throw new Error("agents/ needs two files");
  return { agentA, agentB };
}

describe("install", () => {
  test("links every agent and workflow, skips dotfiles", async () => {
    const { claudeDir } = env();
    const tenboxRoot = await sourceRoot();
    const r = await install();
    expect(r.ok).toBe(true);
    expect(r.claude_dir).toBe(claudeDir);
    const agentNames = await sourceNames("agents");
    const workflowNames = await sourceNames("workflows");
    const expected = [
      ...agentNames.map((name) => ({ dir: "agents", name })),
      ...workflowNames.map((name) => ({ dir: "workflows", name })),
    ];
    expect(r.links).toEqual(
      expected.map(({ dir, name }) => ({
        name,
        source: path.join(tenboxRoot, dir, name),
        link: path.join(claudeDir, dir, name),
        state: "linked",
      })),
    );
    const linked = await files.list(path.join(claudeDir, "agents"));
    const gitkeep = await files.readLink(path.join(claudeDir, "agents", ".gitkeep"));
    expect(linked.sort()).toEqual(agentNames);
    expect(gitkeep).toBeNull();
  });

  test("a second run reports every link unchanged", async () => {
    await install();
    const r = await install();
    expect(r.ok).toBe(true);
    expect(r.links.length).toBeGreaterThan(0);
    expect(r.links.every((l) => l.state === "unchanged")).toBe(true);
  });

  test("leaves a foreign file and a foreign symlink alone and reports ok false", async () => {
    const { claudeDir } = env();
    const { agentA, agentB } = await twoAgents();
    const agents = path.join(claudeDir, "agents");
    await mkdir(agents, { recursive: true });
    await writeFile(path.join(agents, agentA), "my own file");
    await symlink("/elsewhere/agent.md", path.join(agents, agentB));
    const r = await install();
    expect(r.ok).toBe(false);
    expect(r.links.filter((l) => l.state === "skipped").map((l) => l.name)).toEqual([
      agentA,
      agentB,
    ]);
    expect(r.links.filter((l) => l.state === "linked").length).toBe(r.links.length - 2);
    const ownFile = await files.read(path.join(agents, agentA));
    const foreignLink = await files.readLink(path.join(agents, agentB));
    expect(ownFile).toBe("my own file");
    expect(foreignLink).toBe("/elsewhere/agent.md");
  });

  test("from a task worktree, links point into the main checkout and survive its removal", async () => {
    const withRoles = await makeTempProject({ "agents/a.md": "a", "workflows/w.js": "w" });
    try {
      const { claudeDir } = env();
      // git gives real paths; on macOS the temp dir is behind a symlink (/var -> /private/var).
      const mainDir = await files.realPath(withRoles.mainDir);
      const taskWorktree = await withRoles.addTaskWorktree("TEN-1");
      const r = await install(taskWorktree);
      expect(r.ok).toBe(true);
      expect(r.links.map((l) => l.name)).toEqual(["a.md", "w.js"]);
      for (const l of r.links) expect(l.source.startsWith(mainDir)).toBe(true);
      await git.removeWorktree(withRoles.mainDir, taskWorktree);
      await rm(taskWorktree, { recursive: true, force: true });
      const resolved: boolean[] = [];
      for (const l of r.links) {
        const exists = await files.exists(l.link);
        resolved.push(exists);
      }
      const agentLink = await files.readLink(path.join(claudeDir, "agents", "a.md"));
      expect(resolved).toEqual([true, true]);
      expect(agentLink).toBe(path.join(mainDir, "agents", "a.md"));
    } finally {
      await withRoles.remove();
    }
  });

  test("outside a git repository it is no-repo and links nothing", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "tenbox-no-repo-"));
    try {
      await expect(install(outside)).rejects.toMatchObject({ code: "no-repo" });
      const agentLinks = await files.list(path.join(env().claudeDir, "agents"));
      expect(agentLinks).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
