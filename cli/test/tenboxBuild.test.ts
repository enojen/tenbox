import { expect, test } from "bun:test";
import path from "node:path";
import { CARD_KIND } from "../../domain/build.ts";
import type { Group } from "../../domain/group.ts";

const WORKFLOW = path.join(import.meta.dir, "..", "..", "workflows", "tenbox-build.js");
const WORKER_ROLE = path.join(import.meta.dir, "..", "..", "agents", "worker.md");
const EXPORT_PREFIX = /^export /m;
const KIND_ENUM = /kind: \{ enum: \[([^\]]*)\] \}/;
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
  model?: string;
  effort?: string;
}

type ScriptedAgent = (prompt: string, options: AgentOptions) => Promise<unknown>;

interface ReviewerSchema {
  properties: { nice_to_have: { maxItems?: number } } & Record<string, unknown>;
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
    if (options.label === MERGE_LABEL) return null;
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
    if (options.agentType === "runner") return { ok: true, file: "f" };
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
const MERGE_LABEL = "merge attention";

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
    if (options.label === MERGE_LABEL) return null;
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

test("the worker schema and the worker role name the card kinds of CARD_KIND", async () => {
  const script = await Bun.file(WORKFLOW).text();
  const kinds = script
    .match(KIND_ENUM)?.[1]
    ?.split(",")
    .map((kind) => kind.trim().slice(1, -1));
  expect(kinds).toEqual([...CARD_KIND]);
  const role = await Bun.file(WORKER_ROLE).text();
  for (const kind of CARD_KIND) expect(role).toContain(`\`${kind}\``);
});

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

test("a failing approval check returns not-approved and starts no other agent", async () => {
  const started: string[] = [];
  const agent: ScriptedAgent = async (_prompt, options) => {
    started.push(options.agentType);
    return {
      ok: false,
      error: "T has no approved plan; run: tenbox approve T",
      code: "not-approved",
    };
  };
  const result = await runWorkflow("TB-1", agent);
  expect(result).toMatchObject({
    status: "not-approved",
    round: 0,
    error: "T has no approved plan; run: tenbox approve T",
  });
  expect(started).toEqual(["runner", "runner"]);
});

test("the approval check runs `tenbox approved <task>` before any other agent", async () => {
  const prompts: string[] = [];
  const agent: ScriptedAgent = async (prompt, options) => {
    prompts.push(`${options.agentType}: ${prompt}`);
    if (options.agentType === "runner") return { ok: true, commit: "c", file: "f" };
    if (options.agentType === "planner") return { parts: [], lenses: [] };
    return cleanReply;
  };
  await runWorkflow("TB-1", agent);
  expect(prompts[0]).toContain("runner: ");
  expect(prompts[0]).toContain("tenbox approved TB-1");
});

/** Runs the workflow with clean reviews after `mustFixRounds` rounds with a must_fix item; `fullReplies` are the answers of the full-checks runner, round by round. */
async function runWithFullChecks(fullReplies: object[], mustFixRounds = 0) {
  const labels: string[] = [];
  const prompts: Record<string, string> = {};
  let fullRuns = 0;
  let round = 0;
  const agent: ScriptedAgent = async (prompt, options) => {
    labels.push(options.label);
    prompts[options.label] = prompt;
    if (options.agentType === "planner") {
      round += 1;
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: [] };
    }
    if (options.agentType === "worker") return { status: "done", proofs: [] };
    if (options.label.endsWith("full checks")) {
      fullRuns += 1;
      return fullReplies[fullRuns - 1];
    }
    if (options.agentType === "runner") return { ok: true, commit: "c", file: "f" };
    return round <= mustFixRounds ? { ...cleanReply, must_fix: ["fix"] } : cleanReply;
  };
  const result = await runWorkflow("TB-1", agent);
  return { result, labels, prompts };
}

test("a clean review is followed by one full-checks runner before ready-for-you", async () => {
  const { result, labels, prompts } = await runWithFullChecks([{ ok: true }]);
  expect(result.status).toBe("ready-for-you");
  expect(labels.filter((label) => label.endsWith("full checks"))).toEqual(["round 1: full checks"]);
  expect(prompts["round 1: full checks"]).toContain("tenbox check TB-1 --tier full --round 1");
});

test("a red full tier starts the next round with its summary as feedback", async () => {
  const { result, prompts } = await runWithFullChecks([
    { ok: false, summary: "full: 1 new failure" },
    { ok: true },
  ]);
  expect(result.status).toBe("ready-for-you");
  expect(result.round).toBe(2);
  expect(prompts["round 2: 01"]).toContain("full: 1 new failure");
});

test("a round whose review has must_fix does not run the full tier", async () => {
  const { labels } = await runWithFullChecks([{ ok: true }], 1);
  expect(labels.filter((label) => label.endsWith("full checks"))).toEqual(["round 2: full checks"]);
});

const decisionCard = {
  title: "Which store?",
  options: ["files", "sqlite"],
  recommended: 1,
  reason: "r",
  auto: true,
  kind: "scope",
};

test("a blocked worker's decision card goes into the needs-you result with its part", async () => {
  const agent: ScriptedAgent = async (_prompt, options) => {
    if (options.agentType === "planner") {
      return { parts: [{ id: "02", goal: "g", difficulty: "easy" }], lenses: [] };
    }
    if (options.agentType === "worker") {
      return { status: "blocked", proofs: [], decision: decisionCard };
    }
    return { ok: true, file: "f" };
  };
  const result = await runWorkflow("TB-1", agent);
  expect(result).toMatchObject({
    status: "needs-you",
    round: 1,
    part: "02",
    decision: decisionCard,
  });
  expect(result.questions).toBeUndefined();
});

/** The prompt of every agent, by label, of a two-part run whose round 1 review has a must_fix item. */
async function promptsByLabel(args: unknown): Promise<Record<string, string>> {
  const prompts: Record<string, string> = {};
  let round = 0;
  const agent: ScriptedAgent = async (prompt, options) => {
    prompts[options.label] = prompt;
    if (options.agentType === "planner") {
      round += 1;
      const parts = [
        { id: "01", goal: "g", difficulty: "easy" },
        { id: "02", goal: "g", difficulty: "easy" },
      ];
      return { parts, lenses: [] };
    }
    if (options.agentType === "worker") return { status: "done", proofs: [] };
    if (options.agentType === "runner") return { ok: true, commit: "c", file: "f" };
    return round === 1 ? { ...cleanReply, must_fix: ["fix"] } : cleanReply;
  };
  await runWorkflow(args, agent);
  return prompts;
}

test("an answer changes only the worker prompt of its round and part", async () => {
  const answer = { round: 1, part: "02", option: 2, text: "sqlite" };
  const plain = await promptsByLabel("TB-1");
  const answered = await promptsByLabel({ task: "TB-1", answer });
  const changed = Object.keys(plain).filter((label) => plain[label] !== answered[label]);
  expect(changed).toEqual(["round 1: 02"]);
  expect(answered["round 1: 02"]).toContain("option 2: sqlite");
});

interface PartCheckRun {
  result: Awaited<ReturnType<typeof runWorkflow>>;
  order: string[];
  prompts: string[];
}

/** Two parts, one round; `checkReplies` answer the part checks in order (a missing one is green). */
async function runPartChecks(
  checkReplies: object[],
  parts: string[] = ["01", "02"],
  blockedWorker = 0,
): Promise<PartCheckRun> {
  const order: string[] = [];
  const prompts: string[] = [];
  let checkRuns = 0;
  let workers = 0;
  const agent: ScriptedAgent = async (prompt, options) => {
    prompts.push(prompt);
    if (options.agentType === "planner") {
      return { parts: parts.map((id) => ({ id, goal: "g", difficulty: "easy" })), lenses: [] };
    }
    if (options.agentType === "worker") {
      workers += 1;
      order.push(options.label);
      return { status: workers === blockedWorker ? "blocked" : "done", proofs: [] };
    }
    if (options.label.endsWith("full checks")) return { ok: true };
    if (prompt.includes("tenbox check")) {
      order.push(prompt.match(/`(tenbox check[^`]*)`/)?.[1] ?? "");
      checkRuns += 1;
      return checkReplies[checkRuns - 1] ?? { ok: true, commit: "c", file: "f", round: 1 };
    }
    if (options.agentType === "runner") return { ok: true, file: "f" };
    return cleanReply;
  };
  const result = await runWorkflow({ task: "TB-1", maxRounds: 1 }, agent);
  return { result, order, prompts };
}

const redChecks = { ok: false, summary: "lint: 1 new failure", commit: "c", file: "f", round: 1 };

test("each part is checked at once; later checks of the round reuse the round number", async () => {
  const { order, result } = await runPartChecks([{ ok: true, commit: "c", file: "f", round: 4 }]);
  expect(order).toEqual([
    "round 1: 01",
    "tenbox check TB-1",
    "round 1: 02",
    "tenbox check TB-1 --round 4",
  ]);
  expect(result.status).toBe("ready-for-you");
});

test("a red part check runs the same worker again before the next part, then goes on", async () => {
  const { order, result, prompts } = await runPartChecks([redChecks]);
  expect(order).toEqual([
    "round 1: 01",
    "tenbox check TB-1",
    "round 1: 01 fix",
    "tenbox check TB-1 --round 1",
    "round 1: 02",
    "tenbox check TB-1 --round 1",
  ]);
  expect(prompts.find((prompt) => prompt.includes("lint: 1 new failure"))).toContain(
    "status: todo",
  );
  expect(result).toMatchObject({ status: "ready-for-you", round: 1 });
});

test("when the first check gives no round, later checks reuse the round of the fix check", async () => {
  const { order } = await runPartChecks([
    { ok: false, error: "tenbox check did not run" },
    { ok: true, commit: "c", file: "f", round: 5 },
  ]);
  expect(order).toEqual([
    "round 1: 01",
    "tenbox check TB-1",
    "round 1: 01 fix",
    "tenbox check TB-1",
    "round 1: 02",
    "tenbox check TB-1 --round 5",
  ]);
});

test("a second red check ends the round with no review and feeds the next round", async () => {
  const labels: string[] = [];
  const prompts: Record<string, string> = {};
  let checkRuns = 0;
  const agent: ScriptedAgent = async (prompt, options) => {
    labels.push(options.label);
    prompts[options.label] = prompt;
    if (options.agentType === "planner") {
      const ids = ["01", "02"];
      return { parts: ids.map((id) => ({ id, goal: "g", difficulty: "easy" })), lenses: [] };
    }
    if (options.agentType === "worker") return { status: "done", proofs: [] };
    if (options.agentType === "runner") {
      if (prompt.includes("tenbox approved")) return { ok: true, file: "f" };
      checkRuns += 1;
      return checkRuns <= 2 ? redChecks : { ok: true, commit: "c", file: "f", round: 2 };
    }
    return cleanReply;
  };
  await runWorkflow({ task: "TB-1", maxRounds: 2 }, agent);
  expect(labels.filter((label) => label.startsWith("round 1:"))).toEqual([
    "round 1: parts",
    "round 1: 01",
    "round 1: 01 check",
    "round 1: 01 fix",
    "round 1: 01 check fix",
  ]);
  expect(prompts["round 2: parts"]).toContain("part 01: lint: 1 new failure");
});

test("a worker blocked after a fixed part ends needs-you with its part", async () => {
  const { result, order } = await runPartChecks([redChecks], ["01", "02"], 3);
  expect(result).toMatchObject({ status: "needs-you", part: "02" });
  expect(order.filter((entry) => entry.startsWith("tenbox check"))).toHaveLength(2);
});

test("a planner with no part still gets one check before the review", async () => {
  const { order, result } = await runPartChecks([], []);
  expect(order).toEqual(["tenbox check TB-1"]);
  expect(result.status).toBe("ready-for-you");
});

interface GroupCall extends AgentOptions {
  prompt: string;
}

interface GroupRunOptions {
  groups: Group[];
  blockedPart?: string;
  redGroup?: number;
}

interface GroupRun {
  result: Awaited<ReturnType<typeof runWorkflow>>;
  calls: GroupCall[];
  events: string[];
}

const GROUP_PREFIX = /: g(\d+) /;
const groupOf = (label: string): number => Number(label.match(GROUP_PREFIX)?.[1] ?? 0);
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

const groupFor = (id: number, parts: string[], needs: number[] = []): Group => ({
  id,
  name: `feat: group ${id}`,
  parts,
  needs,
  recipe: { model: "sonnet", effort: "medium", lenses: [], tier: "full" },
});

const plannerReply = (options: GroupRunOptions, group: Group | undefined): unknown => {
  if (!group) return { parts: [], lenses: [], groups: options.groups };
  return { parts: group.parts.map((id) => ({ id, goal: "g", difficulty: "easy" })), lenses: [] };
};

const workerReply = (options: GroupRunOptions, label: string): unknown => {
  const blocked = label.endsWith(` ${options.blockedPart}`);
  if (blocked) return { status: "blocked", proofs: [], decision: decisionCard };
  return { status: "done", proofs: [] };
};

const runnerReply = (
  options: GroupRunOptions,
  group: Group | undefined,
  prompt: string,
): unknown => {
  if (prompt.includes("tenbox worktree")) {
    return { ok: true, worktree: `/wt/TB-1-${group?.id}`, branch: `feat/TB-1-${group?.id}` };
  }
  if (!prompt.includes("tenbox check")) return { ok: true, file: "f" };
  if (group?.id === options.redGroup) return { ok: false, summary: "lint: 1 new failure" };
  return { ok: true, commit: "c", file: "f", round: 1 };
};

/** A grouped run: reviewers answer after a delay; `events` are `start <label>` and `end <label>` in time order. */
async function runGroups(options: GroupRunOptions): Promise<GroupRun> {
  const calls: GroupCall[] = [];
  const events: string[] = [];
  const reply = async (prompt: string, agentOptions: AgentOptions): Promise<unknown> => {
    const group = options.groups.find((g) => g.id === groupOf(agentOptions.label));
    if (agentOptions.agentType === "planner") return plannerReply(options, group);
    if (agentOptions.agentType === "worker") return workerReply(options, agentOptions.label);
    if (agentOptions.agentType === "runner") return runnerReply(options, group, prompt);
    await tick();
    return cleanReply;
  };
  const agent: ScriptedAgent = async (prompt, agentOptions) => {
    calls.push({ ...agentOptions, prompt });
    events.push(`start ${agentOptions.label}`);
    const answer = await reply(prompt, agentOptions);
    events.push(`end ${agentOptions.label}`);
    return answer;
  };
  const result = await runWorkflow({ task: "TB-1", maxRounds: 1 }, agent);
  return { result, calls, events };
}

const labelsOf = (calls: GroupCall[]): string[] => calls.map((call) => call.label);

test("two independent groups build in parallel: group 2's worker starts before group 1's review returns", async () => {
  const { events, result } = await runGroups({
    groups: [groupFor(1, ["01"]), groupFor(2, ["02"])],
  });
  expect(events).toContain("start round 1: g2 02");
  expect(events.indexOf("start round 1: g2 02")).toBeLessThan(
    events.indexOf("end round 1: g1 base"),
  );
  expect(result.status).toBe("ready-for-you");
});

test("a group that needs two groups gets its first worker only after both are ready-for-you", async () => {
  const { events } = await runGroups({
    groups: [groupFor(1, ["01"]), groupFor(2, ["02"]), groupFor(3, ["03"], [1, 2])],
  });
  const firstWorkerOf3 = events.indexOf("start round 1: g3 03");
  expect(firstWorkerOf3).toBeGreaterThan(events.indexOf("end round 1: g1 full checks"));
  expect(firstWorkerOf3).toBeGreaterThan(events.indexOf("end round 1: g2 full checks"));
  expect(events.indexOf("end round 1: g2 full checks")).toBeGreaterThan(-1);
});

test("each group opens its worktree, and its workers, checks and reviewers work there", async () => {
  const { calls } = await runGroups({ groups: [groupFor(1, ["01"]), groupFor(2, ["02"])] });
  for (const id of [1, 2]) {
    const own = calls.filter((call) => groupOf(call.label) === id);
    expect(own.some((call) => call.prompt.includes(`tenbox worktree TB-1 --group ${id}`))).toBe(
      true,
    );
    const checks = own.filter((call) => call.prompt.includes("tenbox check"));
    for (const check of checks) expect(check.prompt).toContain(`tenbox check TB-1 --group ${id}`);
    const working = own.filter((call) => ["worker", "reviewer"].includes(call.agentType));
    expect(working.length).toBe(2);
    for (const call of working) expect(call.prompt).toContain(`/wt/TB-1-${id}`);
  }
});

test("the recipe sets the workers' model and effort, the group's lenses and its check tier", async () => {
  const group1 = groupFor(1, ["01"]);
  group1.recipe = { model: "opus", effort: "low", lenses: ["security"], tier: "full" };
  const group2 = groupFor(2, ["02"]);
  group2.recipe = { model: "haiku", effort: "high", lenses: [], tier: "fast" };
  const { calls } = await runGroups({ groups: [group1, group2] });
  const worker1 = calls.find((call) => call.label === "round 1: g1 01");
  expect(worker1).toMatchObject({ model: "opus", effort: "low" });
  const worker2 = calls.find((call) => call.label === "round 1: g2 02");
  expect(worker2).toMatchObject({ model: "haiku", effort: "high" });
  const labels = labelsOf(calls);
  expect(labels).toContain("round 1: g1 security");
  expect(labels).not.toContain("round 1: g2 security");
  expect(labels).toContain("round 1: g1 full checks");
  expect(labels).not.toContain("round 1: g2 full checks");
});

test("a group that ends needs-you gives needs-you with its part and card, and its dependants start nothing", async () => {
  const { result, calls } = await runGroups({
    groups: [groupFor(1, ["01"]), groupFor(2, ["02"], [1])],
    blockedPart: "01",
  });
  expect(result).toMatchObject({
    status: "needs-you",
    round: 1,
    part: "01",
    decision: decisionCard,
  });
  expect(calls.filter((call) => groupOf(call.label) === 2)).toEqual([]);
});

test("needs-you takes the card of the lowest group that needs you", async () => {
  const { result } = await runGroups({
    groups: [groupFor(1, ["01"]), groupFor(2, ["02"])],
    blockedPart: "02",
  });
  expect(result).toMatchObject({ status: "needs-you", part: "02" });
});

test("a group that fails gives failed with its feedback", async () => {
  const { result } = await runGroups({
    groups: [groupFor(1, ["01"]), groupFor(2, ["02"])],
    redGroup: 2,
  });
  expect(result).toMatchObject({ status: "failed", round: 1 });
  expect(result.feedback).toContain("group 2");
  expect(result.feedback).toContain("lint: 1 new failure");
});

test("a plan without groups gives the same agent calls as today", async () => {
  const labels: string[] = [];
  const agent: ScriptedAgent = async (_prompt, options) => {
    labels.push(options.label);
    if (options.agentType === "planner") {
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: [], groups: [] };
    }
    if (options.agentType === "worker") return { status: "done", proofs: [] };
    if (options.agentType === "runner") return { ok: true, commit: "c", file: "f", round: 1 };
    return cleanReply;
  };
  const result = await runWorkflow("TB-1", agent);
  expect(result.status).toBe("ready-for-you");
  expect(labels).toEqual([
    "approval",
    "round 1: parts",
    "round 1: 01",
    "round 1: 01 check",
    "round 1: base",
    "round 1: full checks",
    "record build",
    "open pr",
  ]);
});

/** Runs a one-part build whose runners answer by label; `reply` overrides a runner's answer. */
async function runWithPr(reply: (label: string, prompt: string) => object | undefined) {
  const calls: { label: string; prompt: string }[] = [];
  const agent: ScriptedAgent = async (prompt, options) => {
    calls.push({ label: options.label, prompt });
    if (options.agentType === "planner") {
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: [], groups: [] };
    }
    if (options.agentType === "worker") return { status: "done", proofs: [] };
    if (options.agentType === "runner") {
      return reply(options.label, prompt) ?? { ok: true, commit: "c", file: "f", round: 1 };
    }
    return cleanReply;
  };
  const result = await runWorkflow("TB-1", agent);
  return { result, calls, prCalls: calls.filter((call) => call.label === "open pr") };
}

test("a ready build whose record is ok runs `tenbox pr` and returns its JSON as pr", async () => {
  const pr = { ok: true, task: "TB-1", groups: [] };
  const { result, prCalls } = await runWithPr((label) => (label === "open pr" ? pr : undefined));
  expect(result.status).toBe("ready-for-you");
  expect(result.pr).toEqual(pr);
  expect(prCalls).toHaveLength(1);
  expect(prCalls[0]?.prompt).toContain("tenbox pr TB-1");
});

test("a failed tenbox pr keeps ready-for-you with pr.ok false", async () => {
  const { result } = await runWithPr((label) =>
    label === "open pr" ? { ok: false, error: "dirty" } : undefined,
  );
  expect(result.status).toBe("ready-for-you");
  expect(result.pr).toMatchObject({ ok: false });
});

test("a ready build whose tenbox build done is not ok runs no tenbox pr", async () => {
  const { result, prCalls } = await runWithPr((label) =>
    label === "record build" ? { ok: false, error: "bad" } : undefined,
  );
  expect(result.status).toBe("ready-for-you");
  expect(prCalls).toHaveLength(0);
  expect("pr" in result).toBe(false);
});

test("not-approved and failed builds run no tenbox pr and have no pr key", async () => {
  const notApproved = await runWithPr((label) =>
    label === "approval" ? { ok: false, error: "no" } : undefined,
  );
  expect(notApproved.result.status).toBe("not-approved");
  expect(notApproved.prCalls).toHaveLength(0);
  expect("pr" in notApproved.result).toBe(false);
  const failed = await runWithPr((label) =>
    label.includes(": 01 check") ? { ok: false, error: "red" } : undefined,
  );
  expect(failed.result.status).toBe("failed");
  expect(failed.prCalls).toHaveLength(0);
  expect("pr" in failed.result).toBe(false);
});

test("the pr schema keeps groups, so a schema-shaped reply reports group 2 as waiting", async () => {
  const groups = [
    { id: 1, state: "opened" },
    { id: 2, state: "waiting" },
  ];
  const agent: ScriptedAgent = async (_prompt, options) => {
    if (options.agentType === "planner") {
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: [], groups: [] };
    }
    if (options.agentType === "worker") return { status: "done", proofs: [] };
    if (options.agentType !== "runner") return cleanReply;
    const reply: Record<string, unknown> = { ok: true, commit: "c", file: "f", round: 1, groups };
    const allowed = Object.keys(options.schema?.properties ?? {});
    if (options.label !== "open pr") return reply;
    return Object.fromEntries(Object.entries(reply).filter(([key]) => allowed.includes(key)));
  };
  const result = await runWorkflow("TB-1", agent);
  expect(result.pr.groups).toEqual(groups);
});

/** One clean-checks round whose two lenses flag attention items; `merge` answers the merge agent. */
async function runAttentionBuild(attention: string[][], merge: unknown) {
  const merges: { prompt: string; schema: unknown }[] = [];
  const agent: ScriptedAgent = async (prompt, options) => {
    if (options.agentType === "planner") {
      return { parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: ["security"] };
    }
    if (options.agentType === "worker") return { status: "done", proofs: [] };
    if (options.agentType === "runner") return { ok: true, commit: "c", file: "f" };
    if (options.label === MERGE_LABEL) {
      merges.push({ prompt, schema: options.schema });
      return merge;
    }
    const items = attention[options.label.endsWith("base") ? 0 : 1] ?? [];
    return { ...cleanReply, attention: items };
  };
  const result = await runWorkflow("TB-1", agent);
  return { result, merges };
}

test("two lenses flagging one hunk end with the one item the merge agent returns", async () => {
  const { result, merges } = await runAttentionBuild(
    [["a.ts: guard missing"], ["a.ts: missing guard"]],
    { attention: ["a.ts: guard missing (base, security)"] },
  );
  expect(result.attention).toEqual(["a.ts: guard missing (base, security)"]);
  expect(merges).toHaveLength(1);
  const prompt = merges[0]?.prompt ?? "";
  expect(prompt).toContain("round 1, lens base");
  expect(prompt).toContain("round 1, lens security");
  expect(prompt).toContain("a.ts: guard missing");
  expect(prompt).toContain("a.ts: missing guard");
  expect(prompt).toContain("not sure");
  expect(prompt).toContain("last round");
});

test("the merge schema is { attention: string[] }", async () => {
  const { merges } = await runAttentionBuild([["x"], []], { attention: ["x"] });
  expect(merges[0]?.schema).toEqual({
    type: "object",
    properties: { attention: { type: "array", items: { type: "string" } } },
    required: ["attention"],
  });
});

test("no attention items run no merge agent and give attention []", async () => {
  const { result, merges } = await runAttentionBuild([[], []], { attention: ["never"] });
  expect(merges).toHaveLength(0);
  expect(result.attention).toEqual([]);
});

test("a null merge reply leaves attention as the raw item texts", async () => {
  const { result } = await runAttentionBuild([["one"], ["two"]], null);
  expect(result.attention).toEqual(["one", "two"]);
});
