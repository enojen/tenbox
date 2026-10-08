import { describe, expect, test } from "bun:test";
import { errorMessage, isDigits, minutesBetween } from "./utils.ts";

describe("isDigits", () => {
  test("accepts whole numbers", () => {
    expect(isDigits("0")).toBe(true);
    expect(isDigits("123")).toBe(true);
  });
  test("rejects everything else", () => {
    for (const s of ["", "-1", "1.5", "12a", " 1"]) expect(isDigits(s)).toBe(false);
  });
});

describe("errorMessage", () => {
  test("takes the message of an Error and stringifies anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});

test("minutesBetween rounds to one decimal and is null without a time", () => {
  expect(minutesBetween("2026-01-01T00:00:00Z", "2026-01-01T00:01:30Z")).toBe(1.5);
  expect(minutesBetween(null, "2026-01-01T00:00:00Z")).toBeNull();
});
