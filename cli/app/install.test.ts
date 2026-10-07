import { describe, expect, test } from "bun:test";
import { fakePorts } from "../test/fakes.ts";
import { install } from "./install.ts";

const ROOT = "/tenbox";
const CLAUDE = "/home/u/.claude";

function ports() {
  const p = fakePorts({ cwd: ROOT, wtRoot: "/wt", tenboxRoot: ROOT, claudeDir: CLAUDE, git: () => null });
  p.files.seed({
    [`${ROOT}/agents/.gitkeep`]: "",
    [`${ROOT}/agents/planner.md`]: "# planner",
    [`${ROOT}/agents/worker.md`]: "# worker",
    [`${ROOT}/workflows/tenbox-plan.js`]: "// plan",
  });
  return p;
}

describe("install", () => {
  test("links every agent and workflow, skips dotfiles", async () => {
    const p = ports();
    const r = await install(p);
    expect(r).toEqual({
      ok: true,
      claude_dir: CLAUDE,
      links: [
        { name: "planner.md", source: `${ROOT}/agents/planner.md`, target: `${CLAUDE}/agents/planner.md`, state: "linked" },
        { name: "worker.md", source: `${ROOT}/agents/worker.md`, target: `${CLAUDE}/agents/worker.md`, state: "linked" },
        { name: "tenbox-plan.js", source: `${ROOT}/workflows/tenbox-plan.js`, target: `${CLAUDE}/workflows/tenbox-plan.js`, state: "linked" },
      ],
    });
    expect(await p.files.isDir(`${CLAUDE}/agents`)).toBe(true);
    expect(await p.files.isDir(`${CLAUDE}/workflows`)).toBe(true);
    expect(await p.files.readLink(`${CLAUDE}/agents/.gitkeep`)).toBeNull();
    expect(await p.files.list(`${CLAUDE}/agents`)).toEqual(["planner.md", "worker.md"]);
  });

  test("a second run changes nothing", async () => {
    const p = ports();
    await install(p);
    const before = new Map(p.files.links);
    const r = await install(p);
    expect(r.ok).toBe(true);
    expect(r.links.map((l) => l.state)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(p.files.links).toEqual(before);
  });

  test("leaves a foreign file or symlink alone and reports ok false", async () => {
    const p = ports();
    p.files.put(`${CLAUDE}/agents/planner.md`, "my own planner");
    p.files.links.set(`${CLAUDE}/agents/worker.md`, "/elsewhere/worker.md");
    const r = await install(p);
    expect(r.ok).toBe(false);
    expect(r.links.map((l) => [l.name, l.state])).toEqual([
      ["planner.md", "skipped"],
      ["worker.md", "skipped"],
      ["tenbox-plan.js", "linked"],
    ]);
    expect(await p.files.read(`${CLAUDE}/agents/planner.md`)).toBe("my own planner");
    expect(await p.files.readLink(`${CLAUDE}/agents/worker.md`)).toBe("/elsewhere/worker.md");
    expect(await p.files.readLink(`${CLAUDE}/workflows/tenbox-plan.js`)).toBe(`${ROOT}/workflows/tenbox-plan.js`);
  });
});
