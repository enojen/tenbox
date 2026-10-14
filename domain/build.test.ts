import { expect, test } from "bun:test";
import { parseBuild } from "./build.ts";

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
