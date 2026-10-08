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

test("a part field from the worker cannot override the real part id", async () => {
  const { result } = await runWithProofs(1, "done", { part: "99" });
  expect(result.proofs).toEqual([{ part: "01", ...proofFor("test 1") }]);
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

interface ScriptedProof {
  file: string;
  test: string;
  failure: string;
}

const proofFor = (name: string): ScriptedProof => ({
  file: "a.test.ts",
  test: name,
  failure: "got 1",
});

/** Runs the workflow with a worker that returns one proof per round; `status` is the last worker status. */
async function runWithProofs(
  maxRounds: number,
  lastWorkerStatus: "done" | "blocked",
  extraProofFields: object = {},
) {
  const source = (await Bun.file(WORKFLOW).text()).replace(EXPORT_PREFIX, "");
  const run = new AsyncFunction("args", "agent", "parallel", "phase", source);
  const reviewerPrompts: string[] = [];
  let workers = 0;
  const agent = async (prompt: string, options: { agentType: string }) => {
    if (options.agentType === "planner") {
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: [] };
    }
    if (options.agentType === "worker") {
      workers += 1;
      const status = workers === maxRounds ? lastWorkerStatus : "done";
      return { status, proofs: [{ ...proofFor(`test ${workers}`), ...extraProofFields }] };
    }
    if (options.agentType === "runner") return { ok: true, commit: "c", file: "f" };
    reviewerPrompts.push(prompt);
    return { ...cleanReply, must_fix: ["again"] };
  };
  const parallel = (jobs: (() => Promise<unknown>)[]) => Promise.all(jobs.map((job) => job()));
  const result = await run({ task: "TB-1", maxRounds }, agent, parallel, () => {});
  return { result, reviewerPrompts };
}

test("the workflow adds the part id to worker proofs and keeps every round's proofs", async () => {
  const { result } = await runWithProofs(2, "done");
  expect(result.status).toBe("failed");
  expect(result.proofs).toEqual([
    { part: "01", ...proofFor("test 1") },
    { part: "01", ...proofFor("test 2") },
  ]);
});

test("needs-you returns the proofs found so far", async () => {
  const { result } = await runWithProofs(2, "blocked");
  expect(result.status).toBe("needs-you");
  expect(result.proofs).toEqual([
    { part: "01", ...proofFor("test 1") },
    { part: "01", ...proofFor("test 2") },
  ]);
});

test("the reviewer prompt lists the proofs collected so far", async () => {
  const { reviewerPrompts } = await runWithProofs(2, "done");
  expect(reviewerPrompts[0]).toContain("test 1");
  expect(reviewerPrompts[0]).not.toContain("test 2");
  expect(reviewerPrompts[1]).toContain("test 2");
});

test("the worker schema requires proofs of non-blank strings", async () => {
  const source = (await Bun.file(WORKFLOW).text()).replace(EXPORT_PREFIX, "");
  const run = new AsyncFunction("args", "agent", "parallel", "phase", source);
  const schemas: Record<
    string,
    {
      required: string[];
      properties: {
        proofs: {
          items: { required: string[]; properties: Record<string, { pattern: string }> };
        };
      };
    }
  > = {};
  const agent = async (_prompt: string, options: { agentType: string; schema: never }) => {
    schemas[options.agentType] = options.schema;
    if (options.agentType === "planner")
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: [] };
    return { status: "blocked", questions: [] };
  };
  await run(
    "TB-1",
    agent,
    () => Promise.resolve([]),
    () => {},
  );
  const worker = schemas.worker;
  expect(worker?.required).toContain("proofs");
  expect(worker?.properties.proofs.items.required).toEqual(["file", "test", "failure"]);
  const filled = new RegExp(worker?.properties.proofs.items.properties.test?.pattern ?? "");
  expect(["a", " a ", "", "   "].map((value) => filled.test(value))).toEqual([
    true,
    true,
    false,
    false,
  ]);
});
