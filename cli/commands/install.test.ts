import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { install } from "./install.ts";

let project: TempProject;

beforeEach(async () => {
  project = await makeTempProject({});
});

afterEach(async () => {
  await project.remove();
});

async function sourceNames(dir: string): Promise<string[]> {
  const names = await files.list(path.join(env().tenboxRoot, dir));
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
    const { tenboxRoot, claudeDir } = env();
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
});
