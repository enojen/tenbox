import { expect, test } from "bun:test";
import { type DecisionCard, getOption, isAutoAllowed } from "./cards.ts";

type CardKind = DecisionCard["kind"];

const card = (auto: boolean, kind: CardKind = "scope"): DecisionCard => ({
  title: "Which store?",
  options: ["files", "sqlite"],
  recommended: 2,
  reason: "r",
  auto,
  kind,
});

const NEVER_AUTO_KINDS: CardKind[] = [
  "migration",
  "data-delete",
  "feature-delete",
  "contract",
  "paid-service",
  "locked-file",
];
const AUTO_KINDS: CardKind[] = ["scope", "other"];

test.each(NEVER_AUTO_KINDS)("kind %s is never auto", (kind) => {
  expect(isAutoAllowed(card(true, kind))).toBe(false);
});

test.each(AUTO_KINDS)("kind %s with auto true may be auto-answered", (kind) => {
  expect(isAutoAllowed(card(true, kind))).toBe(true);
});

test("kind scope with auto false is not auto-answered", () => {
  expect(isAutoAllowed(card(false))).toBe(false);
});

test("getOption gives the text of a 1-based option and refuses any other number with usage", () => {
  expect(getOption(card(true), 2)).toBe("sqlite");
  expect(() => getOption(card(true), 3)).toThrow(expect.objectContaining({ code: "usage" }));
  expect(() => getOption(card(true), 1.5)).toThrow(expect.objectContaining({ code: "usage" }));
});
