import { expect, test } from "bun:test";
import { addDeadline, autoCardOf, getOpenCard } from "./answers.ts";
import { type BuildResult, parseBuild } from "./builds.ts";
import type { DecisionCard } from "./cards.ts";

const card: DecisionCard = {
  title: "Which store?",
  options: ["files", "sqlite"],
  recommended: 2,
  reason: "r",
  auto: false,
  kind: "scope",
};

const needsYou: BuildResult = parseBuild(
  JSON.stringify({
    status: "needs-you",
    round: 2,
    part: "03",
    proofs: [],
    attention: [],
    nice_to_have: [],
    unproven: [],
    decision: card,
  }),
);

test("getOpenCard gives the needs-you card with its round and part", () => {
  expect(getOpenCard(needsYou, "T-1")).toEqual({ result: needsYou, card, round: 2, part: "03" });
});

test("getOpenCard is no-decision without a needs-you card and answered once answered", () => {
  expect(() => getOpenCard(null, "T-1")).toThrow(expect.objectContaining({ code: "no-decision" }));
  const ready: BuildResult = { ...needsYou, status: "ready-for-you" };
  expect(() => getOpenCard(ready, "T-1")).toThrow(expect.objectContaining({ code: "no-decision" }));
  const answered = { option: 1, at: "2026-10-14T12:00:00.000Z", auto: false };
  expect(() => getOpenCard({ ...needsYou, answered }, "T-1")).toThrow(
    expect.objectContaining({ code: "answered" }),
  );
});

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

test("autoCardOf gives the deadline and the recommended option of an open auto card", () => {
  const result = addDeadline(parsedCard(true), NOW);
  expect(autoCardOf(result)).toEqual({ deadline: IN_30_MINUTES, recommended: 2 });
  expect(autoCardOf(addDeadline(parsedCard(false), NOW))).toBeNull();
  const answered = { option: 1, at: NOW.toISOString(), auto: false };
  expect(autoCardOf({ ...result, answered })).toBeNull();
  expect(autoCardOf(null)).toBeNull();
});
