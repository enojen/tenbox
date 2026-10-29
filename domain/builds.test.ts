import { expect, test } from "bun:test";
import {
  assertKindFits,
  type BuildResult,
  buildArgs,
  buildKind,
  groupTiers,
  parseBuild,
  readBuild,
} from "./builds.ts";
import type { DiffFile } from "./diffs.ts";
import type { Group } from "./groups.ts";
import type { TaskKind } from "./kinds.ts";
import type { PlanResult } from "./plans.ts";

const IN_30_MINUTES = "2026-10-14T12:30:00.000Z";

const card = {
  title: "Which store?",
  options: ["files", "sqlite"],
  reason: "r",
  auto: true,
  kind: "scope",
};

const needsYou = (decision: Record<string, unknown>): string =>
  JSON.stringify({
    status: "needs-you",
    round: 1,
    part: "03",
    proofs: [],
    attention: [],
    nice_to_have: [],
    unproven: [],
    decision,
  });

test("a card without kind or with an unknown kind is bad-input", () => {
  const { kind: _kind, ...noKind } = card;
  expect(() => parseBuild(needsYou({ ...noKind, recommended: 1 }))).toThrow(
    expect.objectContaining({ code: "bad-input" }),
  );
  expect(() => parseBuild(needsYou({ ...card, kind: "foo", recommended: 1 }))).toThrow(
    expect.objectContaining({ code: "bad-input" }),
  );
});

test("a card whose recommended option is not one of its options is bad-input", () => {
  expect(() => parseBuild(needsYou({ ...card, recommended: 3 }))).toThrow(
    expect.objectContaining({ code: "bad-input" }),
  );
  expect(() => parseBuild(needsYou({ ...card, recommended: 0 }))).toThrow(
    expect.objectContaining({ code: "bad-input" }),
  );
});

test("a deadline that is not a date is bad-input, so no timer waits on it", () => {
  const text = needsYou({ ...card, recommended: 1 }).replace(/}$/, ',"deadline":"not-a-date"}');
  expect(() => parseBuild(text)).toThrow(expect.objectContaining({ code: "bad-input" }));
});

test("an answered card whose time is not an ISO date-time is bad-input", () => {
  const answered = (at: string) =>
    needsYou({ ...card, recommended: 1 }).replace(
      /}$/,
      `,"answered":{"option":1,"at":"${at}","auto":false}}`,
    );
  expect(parseBuild(answered(IN_30_MINUTES)).answered?.at).toBe(IN_30_MINUTES);
  expect(() => parseBuild(answered("yesterday"))).toThrow(
    expect.objectContaining({ code: "bad-input" }),
  );
});

const RECIPE: Group["recipe"] = {
  model: "opus",
  effort: "high",
  lenses: ["contract"],
  tier: "full",
};
const FAST: Group["recipe"] = { ...RECIPE, tier: "fast" };
const GROUP: Group = { id: 1, name: "feat: a", parts: ["01"], needs: [], recipe: RECIPE };

const plan = (kind: TaskKind, groups?: Group[]): PlanResult => ({
  summary: "s",
  estimated_lines: 10,
  parts: [{ id: "01", difficulty: "easy" }],
  examples: [],
  decisions: [],
  lenses: ["contract"],
  questions: [],
  kind,
  ...(groups && { groups }),
});

test("the build args of a small plan drop the lenses and force the fast tier, with one review", () => {
  const args = buildArgs({ task: "T-1", plan: plan("small", [GROUP]) });
  const recipe = { ...FAST, lenses: [] };
  expect(args).toEqual({
    task: "T-1",
    kind: "small",
    reviews: 1,
    parts: [{ id: "01", difficulty: "easy" }],
    lenses: [],
    groups: [{ ...GROUP, recipe }],
  });
});

test("the build args of a normal plan keep its lenses and recipes and give three reviews", () => {
  const args = buildArgs({ task: "T-1", plan: plan("normal", [GROUP]) });
  expect([args.kind, args.reviews, args.lenses, args.groups]).toEqual([
    "normal",
    3,
    ["contract"],
    [GROUP],
  ]);
});

test("the build args of a large plan ask for every lens and the full tier", () => {
  const fast = { ...GROUP, recipe: { ...FAST, lenses: [] } };
  const args = buildArgs({ task: "T-1", plan: plan("large", [fast]) });
  expect([args.lenses, args.groups?.[0]?.recipe]).toEqual([
    ["security", "contract"],
    { ...RECIPE, lenses: ["security", "contract"], tier: "full" },
  ]);
});

test("a plan without groups is group 1 at the full tier unless its kind is short", () => {
  expect(groupTiers({ plan: null, kind: "normal" })).toEqual([{ group: 1, tier: "full" }]);
  expect(groupTiers({ plan: plan("small"), kind: "small" })).toEqual([{ group: 1, tier: "fast" }]);
});

test("the group tiers follow the given kind, not the plan's", () => {
  const groups = [GROUP, { ...GROUP, id: 2, recipe: FAST }];
  expect(groupTiers({ plan: plan("small", groups), kind: "normal" })).toEqual([
    { group: 1, tier: "full" },
    { group: 2, tier: "fast" },
  ]);
  expect(groupTiers({ plan: plan("normal", groups), kind: "small" })).toEqual([
    { group: 1, tier: "fast" },
    { group: 2, tier: "fast" },
  ]);
});

const ready = (kind?: TaskKind): BuildResult => ({
  status: "ready-for-you",
  round: 1,
  proofs: [],
  findings: [],
  attention: [],
  nice_to_have: [],
  unproven: [],
  ...(kind && { kind }),
});

test("the kind of a build is the result's, else the plan's, else normal", () => {
  expect(buildKind({ result: ready("large"), plan: plan("small") })).toBe("large");
  expect(buildKind({ result: ready(), plan: plan("small") })).toBe("small");
  expect(buildKind({ result: ready(), plan: null })).toBe("normal");
});

test("an unknown kind in a build result is bad-input", () => {
  const text = JSON.stringify({ ...ready(), kind: "tiny" });
  expect(() => parseBuild(text)).toThrow(expect.objectContaining({ code: "bad-input" }));
});

const changed = (path: string, lines: number): DiffFile => ({ path, added: lines, removed: 0 });

test("a diff inside the limits of its kind passes", () => {
  const files = [changed("a.ts", 100)];
  expect(() => assertKindFits({ kind: "small", plan: plan("small"), files })).not.toThrow();
});

test("a diff over the limits of its kind is kind-raised with the review of the kind it fits", () => {
  const files = [changed("a.ts", 101)];
  expect(() => assertKindFits({ kind: "small", plan: plan("small"), files })).toThrow(
    expect.objectContaining({
      code: "kind-raised",
      details: { kind: "normal", lenses: ["contract"], reviews: 3 },
    }),
  );
});

const FINDING = { title: "t", why: "w", what: "x", done: "d" };

test("a result without findings gets none; one with findings keeps them as drafts", () => {
  const base = {
    status: "failed",
    round: 1,
    proofs: [],
    attention: [],
    nice_to_have: [],
    unproven: [],
  };
  expect(parseBuild(JSON.stringify(base)).findings).toEqual([]);
  const withFinding = parseBuild(JSON.stringify({ ...base, findings: [FINDING] }));
  expect(withFinding.findings).toEqual([{ ...FINDING, labels: [] }]);
});

test("a finding without one of its sections is bad-input", () => {
  const base = {
    status: "failed",
    round: 1,
    proofs: [],
    attention: [],
    nice_to_have: [],
    unproven: [],
  };
  const text = JSON.stringify({ ...base, findings: [{ title: "t", why: "w", what: "x" }] });
  expect(() => parseBuild(text)).toThrow(expect.objectContaining({ code: "bad-input" }));
});

test("readBuild reads build.json and refuses a broken one with bad-file", () => {
  const file = "/t/.tenbox/build.json";
  expect(readBuild(needsYou({ ...card, recommended: 1 }), file).status).toBe("needs-you");
  expect(() => readBuild("{nope", file)).toThrow(expect.objectContaining({ code: "bad-file" }));
  expect(() => readBuild(needsYou({ ...card, recommended: 3 }), file)).toThrow(
    "/t/.tenbox/build.json is not valid",
  );
});
