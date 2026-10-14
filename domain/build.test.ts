import { expect, test } from "bun:test";
import { addDeadline, type BuildResult, parseBuild } from "./build.ts";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const IN_30_MINUTES = "2026-10-14T12:30:00.000Z";

const card = { title: "Which store?", options: ["files", "sqlite"], reason: "r", auto: true };

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

const parsedCard = (auto: boolean): BuildResult =>
  parseBuild(needsYou({ ...card, recommended: 2, auto }));

test("a card whose recommended option is not one of its options is bad-build", () => {
  expect(() => parseBuild(needsYou({ ...card, recommended: 3 }))).toThrow(
    expect.objectContaining({ code: "bad-build" }),
  );
  expect(() => parseBuild(needsYou({ ...card, recommended: 0 }))).toThrow(
    expect.objectContaining({ code: "bad-build" }),
  );
});

test("a card with auto gets a deadline 30 minutes after now", () => {
  const result = addDeadline(parsedCard(true), NOW);
  expect(result.deadline).toBe(IN_30_MINUTES);
});

test("a card without auto gets a null deadline", () => {
  const result = addDeadline(parsedCard(false), NOW);
  expect(result.deadline).toBeNull();
});

test("a result without a card gets no deadline key", () => {
  const result = addDeadline({ ...parsedCard(true), decision: undefined }, NOW);
  expect(Object.hasOwn(result, "deadline")).toBe(false);
});
