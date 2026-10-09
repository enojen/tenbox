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

interface AgentOptions {
  agentType: string;
  label: string;
  schema?: ReviewerSchema;
}

type ScriptedAgent = (prompt: string, options: AgentOptions) => Promise<unknown>;

interface ReviewerSchema {
  properties: { nice_to_have: { maxItems?: number } };
}

/** Runs the workflow script with a scripted agent; parallel jobs run at once. */
async function runWorkflow(args: unknown, agent: ScriptedAgent) {
  const script = await Bun.file(WORKFLOW).text();
  const source = script.replace(EXPORT_PREFIX, "");
  const run = new AsyncFunction("args", "agent", "parallel", "phase", source);
  const parallel = (jobs: (() => Promise<unknown>)[]) => Promise.all(jobs.map((job) => job()));
  return run(args, agent, parallel, () => {});
}

/** Runs the workflow script with scripted agent replies; reviewers answer from `reviews`, round by round. */
async function runBuild(reviews: ReviewReply[][]) {
  let round = 0;
  const agent: ScriptedAgent = async (_prompt, options) => {
    if (options.agentType === "planner") {
      round += 1;
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: ["security"] };
    }
    if (options.agentType === "worker") return { status: "done" };
    if (options.agentType === "runner") return { ok: true, commit: "c", file: "f" };
    const lens = options.label.endsWith("base") ? 0 : 1;
    return reviews[round - 1]?.[lens];
  };
  return runWorkflow("TB-1", agent);
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
  let workers = 0;
  const agent: ScriptedAgent = async (_prompt, options) => {
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
  const result = await runWorkflow("TB-1", agent);
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
  const reviewerPrompts: string[] = [];
  let workers = 0;
  const agent: ScriptedAgent = async (prompt, options) => {
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
  const result = await runWorkflow({ task: "TB-1", maxRounds }, agent);
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
  const script = await Bun.file(WORKFLOW).text();
  const source = script.replace(EXPORT_PREFIX, "");
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

const MAX_NICE_TO_HAVE = 3;

/** Runs two rounds: the runner returns commit `c<round>`; round 1 review has must_fix, round 2 is clean. */
async function runTwoReviewedRounds(round1: ReviewReply) {
  const reviewerPrompts: string[] = [];
  let reviewerSchema: ReviewerSchema | undefined;
  let round = 0;
  const agent: ScriptedAgent = async (prompt, options) => {
    if (options.agentType === "planner") {
      round += 1;
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: [] };
    }
    if (options.agentType === "worker") return { status: "done", proofs: [] };
    if (options.agentType === "runner") return { ok: true, commit: `c${round}`, file: "f" };
    reviewerSchema = options.schema;
    reviewerPrompts.push(prompt);
    return round === 1 ? round1 : cleanReply;
  };
  const result = await runWorkflow("TB-1", agent);
  return { result, reviewerPrompts, reviewerSchema };
}

const round1Reply: ReviewReply = {
  must_fix: ["fix"],
  nice_to_have: ["nice 1"],
  attention: ["hunk 1"],
  unproven: [],
};

test("the reviewer schema caps nice_to_have at 3 items", async () => {
  const { reviewerSchema } = await runTwoReviewedRounds(round1Reply);
  expect(reviewerSchema?.properties.nice_to_have.maxItems).toBe(MAX_NICE_TO_HAVE);
});

test("a feedback round review is scoped to the diff since the last reviewed checks commit", async () => {
  const { reviewerPrompts } = await runTwoReviewedRounds(round1Reply);
  expect(reviewerPrompts[0]).not.toContain("git diff");
  expect(reviewerPrompts[1]).toContain("git diff c1..HEAD");
});

test("attention and nice_to_have items of earlier reviewed rounds stay in the result", async () => {
  const { result } = await runTwoReviewedRounds(round1Reply);
  expect(result.status).toBe("ready-for-you");
  expect(result.attention).toEqual(["hunk 1"]);
  expect(result.nice_to_have).toEqual(["nice 1"]);
});
