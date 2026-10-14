import { expect, test } from "bun:test";
import { addDeadline, isAutoAllowed } from "./answers.ts";
import { type BuildResult, parseBuild } from "./build.ts";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const IN_30_MINUTES = "2026-10-14T12:30:00.000Z";

const parsedCard = (auto: boolean, kind = "scope"): BuildResult =>
  parseBuild(
    JSON.stringify({
      status: "needs-you",
      round: 1,
      part: "03",
      proofs: [],
      attention: [],
      nice_to_have: [],
      unproven: [],
      decision: {
        title: "Which store?",
        options: ["files", "sqlite"],
        recommended: 2,
        reason: "r",
        auto,
        kind,
      },
    }),
  );

const cardOf = (result: BuildResult) => {
  if (result.decision === undefined) throw new Error("no card");
  return result.decision;
};

test("a card with auto gets a deadline 30 minutes after now", () => {
  const result = addDeadline(parsedCard(true), NOW);
  expect(result.deadline).toBe(IN_30_MINUTES);
});

test("a card without auto gets a null deadline", () => {
  const result = addDeadline(parsedCard(false), NOW);
  expect(result.deadline).toBeNull();
});

test("a never-auto card with auto true gets a null deadline", () => {
  const result = addDeadline(parsedCard(true, "migration"), NOW);
  expect(result.deadline).toBeNull();
});

test("a result without a card gets no deadline key", () => {
  const result = addDeadline({ ...parsedCard(true), decision: undefined }, NOW);
  expect(Object.hasOwn(result, "deadline")).toBe(false);
});

test.each([
  "migration",
  "data-delete",
  "feature-delete",
  "contract",
  "paid-service",
  "locked-file",
])("kind %s is never auto", (kind) => {
  expect(isAutoAllowed(cardOf(parsedCard(true, kind)))).toBe(false);
});

test.each(["scope", "other"])("kind %s with auto true may be auto-answered", (kind) => {
  expect(isAutoAllowed(cardOf(parsedCard(true, kind)))).toBe(true);
});

test("kind scope with auto false is not auto-answered", () => {
  expect(isAutoAllowed(cardOf(parsedCard(false)))).toBe(false);
});
