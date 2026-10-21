import { expect, test } from "bun:test";
import {
  assertKindFits,
  type BuildResult,
  buildArgs,
  buildKind,
  groupTiers,
  parseBuild,
  uniqueFiles,
} from "./build.ts";
import type { ChangedFile } from "./changedFile.ts";
import type { Group } from "./group.ts";
import type { TaskKind } from "./kind.ts";
import type { PlanResult } from "./plan.ts";

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

test("a card without kind or with an unknown kind is bad-build", () => {
  const { kind: _kind, ...noKind } = card;
  expect(() => parseBuild(needsYou({ ...noKind, recommended: 1 }))).toThrow(
    expect.objectContaining({ code: "bad-build" }),
  );
  expect(() => parseBuild(needsYou({ ...card, kind: "foo", recommended: 1 }))).toThrow(
    expect.objectContaining({ code: "bad-build" }),
  );
});

test("a card whose recommended option is not one of its options is bad-build", () => {
  expect(() => parseBuild(needsYou({ ...card, recommended: 3 }))).toThrow(
    expect.objectContaining({ code: "bad-build" }),
  );
  expect(() => parseBuild(needsYou({ ...card, recommended: 0 }))).toThrow(
    expect.objectContaining({ code: "bad-build" }),
  );
});

test("a deadline that is not a date is bad-build, so no timer waits on it", () => {
  const text = needsYou({ ...card, recommended: 1 }).replace(/}$/, ',"deadline":"not-a-date"}');
  expect(() => parseBuild(text)).toThrow(expect.objectContaining({ code: "bad-build" }));
});

test("an answered card whose time is not an ISO date-time is bad-build", () => {
  const answered = (at: string) =>
    needsYou({ ...card, recommended: 1 }).replace(
      /}$/,
      `,"answered":{"option":1,"at":"${at}","auto":false}}`,
    );
  expect(parseBuild(answered(IN_30_MINUTES)).answered?.at).toBe(IN_30_MINUTES);
  expect(() => parseBuild(answered("yesterday"))).toThrow(
    expect.objectContaining({ code: "bad-build" }),
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

test("an unknown kind in a build result is bad-build", () => {
  const text = JSON.stringify({ ...ready(), kind: "tiny" });
  expect(() => parseBuild(text)).toThrow(expect.objectContaining({ code: "bad-build" }));
});

const changed = (path: string, lines: number): ChangedFile => ({ path, added: lines, removed: 0 });

test("a path in two diffs counts once, at its larger change", () => {
  const merged = uniqueFiles([
    [changed("a.ts", 10), changed("b.ts", 1)],
    [changed("a.ts", 30), changed("c.ts", 2)],
  ]);
  expect(merged).toEqual([changed("a.ts", 30), changed("b.ts", 1), changed("c.ts", 2)]);
});

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
