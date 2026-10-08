import { expect, test } from "bun:test";
import path from "node:path";

const WORKFLOW = path.join(import.meta.dir, "..", "..", "workflows", "tenbox-build.js");
const EXPORT_PREFIX = /^export /m;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

interface ReviewReply {
  must_fix: string[];
  nice_to_have: string[];
  attention: string[];
  unproven: { part: string; reason: string }[];
}

/** Runs the workflow script with scripted agent replies; reviewers answer from `reviews`, round by round. */
async function runBuild(reviews: ReviewReply[][]) {
  const source = (await Bun.file(WORKFLOW).text()).replace(EXPORT_PREFIX, "");
  const run = new AsyncFunction("args", "agent", "parallel", "phase", source);
  let round = 0;
  const agent = async (_prompt: string, options: { agentType: string; label: string }) => {
    if (options.agentType === "planner") {
      round += 1;
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: ["security"] };
    }
    if (options.agentType === "worker") return { status: "done" };
    if (options.agentType === "runner") return { ok: true, commit: "c", file: "f" };
    const lens = options.label.endsWith("base") ? 0 : 1;
    return reviews[round - 1]?.[lens];
  };
  const parallel = (jobs: (() => Promise<unknown>)[]) => Promise.all(jobs.map((job) => job()));
  return run("TB-1", agent, parallel, () => {});
}

const unprovenReply = (part: string, reason: string, mustFix: string[]): ReviewReply => ({
  must_fix: mustFix,
  nice_to_have: [],
  attention: [],
  unproven: [{ part, reason }],
});
const cleanReply: ReviewReply = { must_fix: [], nice_to_have: [], attention: [], unproven: [] };

test("one part named by two lenses in one round gives one unproven item; a later round gives another", async () => {
  const result = await runBuild([
    [unprovenReply("01", "base", ["a"]), unprovenReply("01", "security", ["b"])],
    [unprovenReply("01", "again", ["c"]), cleanReply],
    [cleanReply, cleanReply],
  ]);
  expect(result.status).toBe("ready-for-you");
  expect(result.unproven).toEqual([
    { part: "01", reason: "base" },
    { part: "01", reason: "again" },
  ]);
});

test("needs-you returns the unproven items found so far", async () => {
  const source = (await Bun.file(WORKFLOW).text()).replace(EXPORT_PREFIX, "");
  const run = new AsyncFunction("args", "agent", "parallel", "phase", source);
  let workers = 0;
  const agent = async (_prompt: string, options: { agentType: string }) => {
    if (options.agentType === "planner") {
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: [] };
    }
    if (options.agentType === "worker") {
      workers += 1;
      return workers === 1 ? { status: "done" } : { status: "blocked", questions: ["q"] };
    }
    if (options.agentType === "runner") return { ok: true, commit: "c", file: "f" };
    return unprovenReply("01", "r", ["a"]);
  };
  const parallel = (jobs: (() => Promise<unknown>)[]) => Promise.all(jobs.map((job) => job()));
  const result = await run("TB-1", agent, parallel, () => {});
  expect(result.status).toBe("needs-you");
  expect(result.unproven).toEqual([{ part: "01", reason: "r" }]);
});
