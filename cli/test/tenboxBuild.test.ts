import { expect, test } from "bun:test";
import path from "node:path";
import { CARD_KIND } from "../../domain/build.ts";
import type { Group } from "../../domain/group.ts";

const WORKFLOW = path.join(import.meta.dir, "..", "..", "workflows", "tenbox-build.js");
const WORKER_ROLE = path.join(import.meta.dir, "..", "..", "agents", "worker.md");
const EXPORT_PREFIX = /^export /m;
const KIND_ENUM = /kind: \{ enum: \[([^\]]*)\] \}/;
const ROUND_PREFIX = /^round (\d+):/;
const CHECK_COMMAND = /`(tenbox check[^`]*)`/;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

interface ReviewReply {
  must_fix: string[];
  nice_to_have: string[];
  attention: string[];
  unproven: { part: string; reason: string }[];
}

/** The parts of a JSON schema the tests read. */
interface SchemaNode {
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  maxItems?: number;
  pattern?: string;
}

interface AgentOptions {
  agentType: string;
  label: string;
  schema?: SchemaNode;
  model?: string;
  effort?: string;
}

type ScriptedAgent = (prompt: string, options: AgentOptions) => Promise<unknown>;

/** Runs the workflow script with a scripted agent; parallel jobs run at once. */
async function runWorkflow(args: unknown, agent: ScriptedAgent) {
  const script = await Bun.file(WORKFLOW).text();
  const source = script.replace(EXPORT_PREFIX, "");
  const run = new AsyncFunction("args", "agent", "parallel", "phase", source);
  const parallel = (jobs: (() => Promise<unknown>)[]) => Promise.all(jobs.map((job) => job()));
  return run(args, agent, parallel, () => {});
}

interface PlanPart {
  id: string;
  difficulty: "easy" | "hard";
}

const planPart = (id: string): PlanPart => ({ id, difficulty: "easy" });

/** The args `tenbox build` sends: the task and the parts and lenses of plan.json. */
const planArgs = (parts: string[] = ["01"], lenses: string[] = [], extra: object = {}) => ({
  task: "TB-1",
  parts: parts.map(planPart),
  lenses,
  ...extra,
});

const green = (commit = "c", round = 1) => ({ ok: true, commit, file: "f", round });
const redChecks = { ok: false, summary: "lint: 1 new failure", commit: "c", file: "f", round: 1 };
const roundOf = (label: string): number => Number(label.match(ROUND_PREFIX)?.[1] ?? 0);
const cleanReply: ReviewReply = { must_fix: [], nice_to_have: [], attention: [], unproven: [] };
const MERGE_LABEL = "merge attention";
const RECORD_LABEL = "record build";

/** Replies by agent type; a missing one gives a green worker, clean review and ok runner. */
interface Replies {
  planner?: ScriptedAgent;
  worker?: ScriptedAgent;
  reviewer?: ScriptedAgent;
  runner?: ScriptedAgent;
}

/** A scripted agent: the planner lists part 01 with no lens; a worker is done with green checks. */
function scripted(replies: Replies): ScriptedAgent {
  const defaults: Required<Replies> = {
    planner: async () => ({ parts: [{ id: "01", goal: "g", difficulty: "easy" }], lenses: [] }),
    worker: async () => ({ status: "done", proofs: [], checks: green() }),
    reviewer: async () => cleanReply,
    runner: async () => ({ ok: true, file: "f" }),
  };
  const byType: Record<string, ScriptedAgent | undefined> = { ...defaults, ...replies };
  return (prompt, options) => {
    const reply = byType[options.agentType];
    if (!reply) throw new Error(`no reply for ${options.agentType}`);
    return reply(prompt, options);
  };
}

/** Runs the workflow; reviewers answer from `reviews`, round by round, base lens first. */
async function runBuild(reviews: ReviewReply[][]) {
  const agent = scripted({
    planner: async () => ({
      parts: [{ id: "01", goal: "g", difficulty: "easy" }],
      lenses: ["security"],
    }),
    reviewer: async (_prompt, options) => {
      if (options.label === MERGE_LABEL) return null;
      const lens = options.label.endsWith("base") ? 0 : 1;
      return reviews[roundOf(options.label) - 1]?.[lens];
    },
  });
  return runWorkflow(planArgs(["01"], ["security"]), agent);
}

const unprovenReply = (part: string, reason: string, mustFix: string[]): ReviewReply => ({
  must_fix: mustFix,
  nice_to_have: [],
  attention: [],
  unproven: [{ part, reason }],
});

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

test("a task id string alone throws an error that names tenbox build", async () => {
  const started: string[] = [];
  const agent: ScriptedAgent = async (_prompt, options) => started.push(options.label);
  await expect(runWorkflow("TB-1", agent)).rejects.toThrow("tenbox build TB-1");
  await expect(runWorkflow({ task: "TB-1" }, agent)).rejects.toThrow("tenbox build TB-1");
  expect(started).toEqual([]);
});

test("the plan args as JSON text run like the object", async () => {
  const labels: string[] = [];
  const agent = scripted({});
  const result = await runWorkflow(JSON.stringify(planArgs()), async (prompt, options) => {
    labels.push(options.label);
    return agent(prompt, options);
  });
  expect(result.status).toBe("ready-for-you");
  expect(labels).toEqual(["round 1: 01", "round 1: base", RECORD_LABEL]);
});

test("a part field from the worker cannot override the real part id", async () => {
  const { result } = await runWithProofs(1, "done", { part: "99" });
  expect(result.proofs).toEqual([{ part: "01", ...proofFor("test 1") }]);
});

test("needs-you returns the unproven items found so far", async () => {
  let workers = 0;
  const agent = scripted({
    worker: async () => {
      workers += 1;
      if (workers === 1) return { status: "done", checks: green() };
      return { status: "blocked", questions: ["q"] };
    },
    reviewer: async () => unprovenReply("01", "r", ["a"]),
  });
  const result = await runWorkflow(planArgs(), agent);
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
  const agent = scripted({
    worker: async () => {
      workers += 1;
      const status = workers === maxRounds ? lastWorkerStatus : "done";
      const proofs = [{ ...proofFor(`test ${workers}`), ...extraProofFields }];
      return { status, proofs, checks: green() };
    },
    reviewer: async (prompt) => {
      reviewerPrompts.push(prompt);
      return { ...cleanReply, must_fix: ["again"] };
    },
  });
  const result = await runWorkflow(planArgs(["01"], [], { maxRounds }), agent);
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

test("the worker schema requires proofs of non-blank strings and takes the check JSON", async () => {
  let worker: SchemaNode | undefined;
  const agent = scripted({
    worker: async (_prompt, options) => {
      worker = options.schema;
      return { status: "blocked", proofs: [] };
    },
  });
  await runWorkflow(planArgs(), agent);
  const proofItem = worker?.properties?.proofs?.items;
  expect(worker?.required).toContain("proofs");
  expect(proofItem?.required).toEqual(["file", "test", "failure"]);
  const filled = new RegExp(proofItem?.properties?.test?.pattern ?? "");
  expect(["a", " a ", "", "   "].map((value) => filled.test(value))).toEqual([
    true,
    true,
    false,
    false,
  ]);
  expect(Object.keys(worker?.properties?.checks?.properties ?? {})).toEqual(
    expect.arrayContaining(["ok", "commit", "round", "file", "summary"]),
  );
});

/** Runs two rounds: the worker's checks commit is `c<round>`; round 1 review has must_fix, round 2 is clean. */
async function runTwoReviewedRounds(round1: ReviewReply) {
  const reviewerPrompts: string[] = [];
  let reviewerSchema: SchemaNode | undefined;
  const agent = scripted({
    worker: async (_prompt, options) => {
      const round = roundOf(options.label);
      return { status: "done", proofs: [], checks: green(`c${round}`, round) };
    },
    reviewer: async (prompt, options) => {
      if (options.label === MERGE_LABEL) return null;
      reviewerSchema = options.schema;
      reviewerPrompts.push(prompt);
      return roundOf(options.label) === 1 ? round1 : cleanReply;
    },
  });
  const result = await runWorkflow(planArgs(), agent);
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
  const MAX_NICE_TO_HAVE = 3;
  const { reviewerSchema } = await runTwoReviewedRounds(round1Reply);
  expect(reviewerSchema?.properties?.nice_to_have?.maxItems).toBe(MAX_NICE_TO_HAVE);
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

const decisionCard = {
  title: "Which store?",
  options: ["files", "sqlite"],
  recommended: 1,
  reason: "r",
  auto: true,
  kind: "scope",
};

test("a blocked worker's decision card goes into the needs-you result with its part", async () => {
  const agent = scripted({
    worker: async () => ({ status: "blocked", proofs: [], decision: decisionCard }),
  });
  const result = await runWorkflow(planArgs(["02"]), agent);
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
  const scriptedAgent = scripted({
    planner: async () => ({ parts: ["01", "02"].map(planPart), lenses: [] }),
    reviewer: async (_prompt, options) =>
      roundOf(options.label) === 1 ? { ...cleanReply, must_fix: ["fix"] } : cleanReply,
  });
  await runWorkflow(args, async (prompt, options) => {
    prompts[options.label] = prompt;
    return scriptedAgent(prompt, options);
  });
  return prompts;
}

test("an answer changes only the worker prompt of its round and part", async () => {
  const answer = { round: 1, part: "02", option: 2, text: "sqlite" };
  const plain = await promptsByLabel(planArgs(["01", "02"]));
  const answered = await promptsByLabel(planArgs(["01", "02"], [], { answer }));
  const changed = Object.keys(plain).filter((label) => plain[label] !== answered[label]);
  expect(changed).toEqual(["round 1: 02"]);
  expect(answered["round 1: 02"]).toContain("option 2: sqlite");
});

test("a plan part has no goal, so its worker prompt has no goal text", async () => {
  const prompts = await promptsByLabel(planArgs(["01", "02"]));
  expect(prompts["round 1: 01"]).toStartWith("Task TB-1, part 01. Round feedback: none");
});

interface PartCheckRun {
  result: Awaited<ReturnType<typeof runWorkflow>>;
  order: string[];
  prompts: string[];
}

/** Two parts, one round; `checkReplies` are the workers' checks in order (a missing one is green). */
async function runPartChecks(
  checkReplies: object[],
  parts: string[] = ["01", "02"],
  blockedWorker = 0,
): Promise<PartCheckRun> {
  const order: string[] = [];
  const prompts: string[] = [];
  let workers = 0;
  const scriptedAgent = scripted({
    worker: async (prompt, options) => {
      workers += 1;
      order.push(options.label, prompt.match(CHECK_COMMAND)?.[1] ?? "");
      const checks = checkReplies[workers - 1] ?? green("c", 1);
      return { status: workers === blockedWorker ? "blocked" : "done", proofs: [], checks };
    },
    runner: async (prompt) => {
      if (!prompt.includes("tenbox check")) return { ok: true, file: "f" };
      order.push(prompt.match(CHECK_COMMAND)?.[1] ?? "");
      return green();
    },
  });
  const agent: ScriptedAgent = (prompt, options) => {
    prompts.push(prompt);
    return scriptedAgent(prompt, options);
  };
  const result = await runWorkflow(planArgs(parts, [], { maxRounds: 1 }), agent);
  return { result, order, prompts };
}

test("each worker runs its own check; later checks of the round reuse the round number", async () => {
  const { order, result } = await runPartChecks([green("c", 4)]);
  expect(order).toEqual([
    "round 1: 01",
    "tenbox check TB-1",
    "round 1: 02",
    "tenbox check TB-1 --round 4",
  ]);
  expect(result.status).toBe("ready-for-you");
});

test("a red worker check runs the same worker again before the next part, then goes on", async () => {
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
    green("c", 5),
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

test("a worker with no checks counts as a red check", async () => {
  const { order } = await runPartChecks([{}], ["01"]);
  expect(order).toEqual([
    "round 1: 01",
    "tenbox check TB-1",
    "round 1: 01 fix",
    "tenbox check TB-1",
  ]);
});

test("a second red check ends the round with no review and feeds the next round", async () => {
  const labels: string[] = [];
  const prompts: Record<string, string> = {};
  let workers = 0;
  const scriptedAgent = scripted({
    worker: async () => {
      workers += 1;
      return { status: "done", proofs: [], checks: workers <= 2 ? redChecks : green("c", 2) };
    },
  });
  await runWorkflow(planArgs(["01", "02"], [], { maxRounds: 2 }), async (prompt, options) => {
    labels.push(options.label);
    prompts[options.label] = prompt;
    return scriptedAgent(prompt, options);
  });
  expect(labels.filter((label) => label.startsWith("round 1:"))).toEqual([
    "round 1: 01",
    "round 1: 01 fix",
  ]);
  expect(prompts["round 2: parts"]).toContain("part 01: lint: 1 new failure");
});

test("a worker blocked after a fixed part ends needs-you with its part", async () => {
  const { result, order } = await runPartChecks([redChecks], ["01", "02"], 3);
  expect(result).toMatchObject({ status: "needs-you", part: "02" });
  expect(order).toEqual([
    "round 1: 01",
    "tenbox check TB-1",
    "round 1: 01 fix",
    "tenbox check TB-1 --round 1",
    "round 1: 02",
    "tenbox check TB-1 --round 1",
  ]);
});

test("args with no part still get one check runner before the review", async () => {
  const { order, result } = await runPartChecks([], []);
  expect(order).toEqual(["tenbox check TB-1"]);
  expect(result.status).toBe("ready-for-you");
});

interface AgentCall extends AgentOptions {
  prompt: string;
}

/** Records every call, then answers with `agent`. */
function recording(agent: ScriptedAgent) {
  const calls: AgentCall[] = [];
  const recorder: ScriptedAgent = (prompt, options) => {
    calls.push({ ...options, prompt });
    return agent(prompt, options);
  };
  return { calls, recorder };
}

test("a one-part plan with green checks and clean reviews runs one worker, the reviewers and one runner", async () => {
  const { calls, recorder } = recording(scripted({}));
  const result = await runWorkflow(planArgs(["01"], ["contract"]), recorder);
  expect(result.status).toBe("ready-for-you");
  expect(calls.map((call) => [call.agentType, call.label])).toEqual([
    ["worker", "round 1: 01"],
    ["reviewer", "round 1: base"],
    ["reviewer", "round 1: contract"],
    ["runner", RECORD_LABEL],
  ]);
  expect(calls.at(-1)?.prompt).toContain("tenbox build done TB-1 --json");
});

/** A run whose `build done` answers `refusals` in order, then ok. */
async function runWithRefusals(refusals: object[], maxRounds = 3) {
  let records = 0;
  const { calls, recorder } = recording(
    scripted({
      runner: async () => {
        records += 1;
        return refusals[records - 1] ?? { ok: true, file: "f" };
      },
    }),
  );
  const result = await runWorkflow(planArgs(["01"], [], { maxRounds }), recorder);
  const recordPrompts = calls.filter((c) => c.label === RECORD_LABEL).map((c) => c.prompt);
  return { result, calls, recordPrompts };
}

const refusal = (code: string, tier: string) => ({
  ok: false,
  error: `group 1: the ${tier} checks of TB-1 have new failures:\ne2e: 1 new failure`,
  code,
  details: { group: 1, tier },
});

test("a refused ready-for-you is recorded again as failed with the refusal as feedback", async () => {
  const stale = { ok: false, error: "group 1: no tenbox check ran", code: "checks-stale" };
  const { result, recordPrompts } = await runWithRefusals([stale]);
  expect(recordPrompts).toHaveLength(2);
  expect(recordPrompts[0]).toContain('"status":"ready-for-you"');
  expect(recordPrompts[1]).toContain('"status":"failed"');
  expect(recordPrompts[1]).toContain('"feedback":"group 1: no tenbox check ran"');
  expect(result).toMatchObject({ status: "failed", feedback: "group 1: no tenbox check ran" });
  expect(result.recorded).toEqual({ ok: true, file: "f" });
});

test("a red fast tier in build done is not a new round", async () => {
  const { result, calls } = await runWithRefusals([refusal("check-failed", "fast")]);
  expect(result.status).toBe("failed");
  expect(calls.filter((call) => call.agentType === "worker")).toHaveLength(1);
});

test("a red full tier in build done starts the next round with its message as feedback", async () => {
  const red = refusal("check-failed", "full");
  const { result, calls, recordPrompts } = await runWithRefusals([red]);
  const round2 = calls.find((call) => call.label === "round 2: parts");
  expect(round2?.prompt).toContain("e2e: 1 new failure");
  expect(recordPrompts).toHaveLength(2);
  expect(result).toMatchObject({ status: "ready-for-you", round: 2 });
});

test("a red full tier with no round left ends failed with its message", async () => {
  const red = refusal("check-failed", "full");
  const { result, recordPrompts } = await runWithRefusals([red], 1);
  expect(result).toMatchObject({ status: "failed", round: 1 });
  expect(result.feedback).toContain("e2e: 1 new failure");
  expect(recordPrompts).toHaveLength(2);
  expect(recordPrompts[1]).toContain('"status":"failed"');
});

test("the record schema keeps pr with its groups, and the result has no top-level pr", async () => {
  const pr = { ok: true, groups: [{ group: 1, state: "created" }] };
  const agent = scripted({
    runner: async (_prompt, options) => {
      const reply: Record<string, unknown> = { ok: true, file: "f", pr, extra: 1 };
      const allowed = Object.keys(options.schema?.properties ?? {});
      return Object.fromEntries(Object.entries(reply).filter(([key]) => allowed.includes(key)));
    },
  });
  const result = await runWorkflow(planArgs(), agent);
  expect(result.recorded).toEqual({ ok: true, file: "f", pr });
  expect("pr" in result).toBe(false);
});

interface GroupRunOptions {
  groups: Group[];
  blockedPart?: string;
  redGroup?: number;
}

interface GroupRun {
  result: Awaited<ReturnType<typeof runWorkflow>>;
  calls: AgentCall[];
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

const workerReply = (options: GroupRunOptions, label: string): unknown => {
  if (label.endsWith(` ${options.blockedPart}`)) {
    return { status: "blocked", proofs: [], decision: decisionCard };
  }
  const red = groupOf(label) === options.redGroup;
  return { status: "done", proofs: [], checks: red ? redChecks : green() };
};

const runnerReply = (prompt: string, label: string): unknown => {
  if (!prompt.includes("tenbox worktree")) return { ok: true, file: "f" };
  const id = groupOf(label);
  return { ok: true, worktree: `/wt/TB-1-${id}`, branch: `feat/TB-1-${id}` };
};

/** A grouped run: reviewers answer after a delay; `events` are `start <label>` and `end <label>` in time order. */
async function runGroups(options: GroupRunOptions): Promise<GroupRun> {
  const calls: AgentCall[] = [];
  const events: string[] = [];
  const reply = async (prompt: string, agentOptions: AgentOptions): Promise<unknown> => {
    if (agentOptions.agentType === "worker") return workerReply(options, agentOptions.label);
    if (agentOptions.agentType === "runner") return runnerReply(prompt, agentOptions.label);
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
  const parts = options.groups.flatMap((group) => group.parts);
  const args = planArgs(parts, [], { groups: options.groups, maxRounds: 1 });
  const result = await runWorkflow(args, agent);
  return { result, calls, events };
}

const labelsOf = (calls: AgentCall[]): string[] => calls.map((call) => call.label);

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
  expect(firstWorkerOf3).toBeGreaterThan(events.indexOf("end round 1: g1 base"));
  expect(firstWorkerOf3).toBeGreaterThan(events.indexOf("end round 1: g2 base"));
  expect(events.indexOf("end round 1: g2 base")).toBeGreaterThan(-1);
});

test("a group above 1 opens its worktree, and its workers and reviewers work there", async () => {
  const { calls } = await runGroups({ groups: [groupFor(1, ["01"]), groupFor(2, ["02"])] });
  const own = (id: number) => calls.filter((call) => groupOf(call.label) === id);
  const opens = (id: number) => own(id).some((call) => call.prompt.includes("tenbox worktree"));
  expect([opens(1), opens(2)]).toEqual([false, true]);
  for (const id of [1, 2]) {
    const worker = own(id).find((call) => call.agentType === "worker");
    expect(worker?.prompt).toContain(`tenbox check TB-1 --group ${id}`);
  }
  const working = own(2).filter((call) => ["worker", "reviewer"].includes(call.agentType));
  expect(working.length).toBe(2);
  for (const call of working) expect(call.prompt).toContain("/wt/TB-1-2");
  for (const call of own(1)) expect(call.prompt).not.toContain("group worktree");
});

test("each group builds the plan parts of its group only", async () => {
  const { calls } = await runGroups({ groups: [groupFor(1, ["01", "03"]), groupFor(2, ["02"])] });
  const workers = calls.filter((call) => call.agentType === "worker").map((call) => call.label);
  expect(workers.sort()).toEqual(["round 1: g1 01", "round 1: g1 03", "round 1: g2 02"]);
});

test("the recipe sets the workers' model and effort and the group's lenses", async () => {
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

test("a red full tier of group 2 gives group 2 the next round in its worktree", async () => {
  const groups = [groupFor(1, ["01"]), groupFor(2, ["02"])];
  let records = 0;
  const red = { ...refusal("check-failed", "full"), details: { group: 2, tier: "full" } };
  const { calls, recorder } = recording(
    scripted({
      runner: async (prompt, options) => {
        if (options.label !== RECORD_LABEL) return runnerReply(prompt, options.label);
        records += 1;
        return records === 1 ? red : { ok: true, file: "f" };
      },
    }),
  );
  const result = await runWorkflow(planArgs(["01", "02"], [], { groups }), recorder);
  const round2 = calls.filter((call) => roundOf(call.label) === 2).map((call) => call.label);
  expect(round2).toEqual(["round 2: g2 parts", "round 2: g2 01", "round 2: g2 base"]);
  expect(calls.find((call) => call.label === "round 2: g2 01")?.prompt).toContain("/wt/TB-1-2");
  expect(result).toMatchObject({ status: "ready-for-you", round: 2 });
});

/** One clean-checks round whose two lenses flag attention items; `merge` answers the merge agent. */
async function runAttentionBuild(attention: string[][], merge: unknown) {
  const merges: { prompt: string; schema: unknown }[] = [];
  const agent = scripted({
    reviewer: async (prompt, options) => {
      if (options.label === MERGE_LABEL) {
        merges.push({ prompt, schema: options.schema });
        return merge;
      }
      const items = attention[options.label.endsWith("base") ? 0 : 1] ?? [];
      return { ...cleanReply, attention: items };
    },
  });
  const result = await runWorkflow(planArgs(["01"], ["security"]), agent);
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
