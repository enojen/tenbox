import { expect, test } from "bun:test";
import { currentRound, nextRound } from "./rounds.ts";

test("nextRound", () => {
  expect(nextRound([])).toBe(1);
  expect(nextRound(["1", "2", "junk", "10"])).toBe(11);
});

test("currentRound is the highest round, 1 when there is none", () => {
  expect(currentRound([])).toBe(1);
  expect(currentRound(["1", "2", "junk", "10"])).toBe(10);
});
