import { describe, expect, test } from "bun:test";
import { isDigits } from "./utils.ts";

describe("isDigits", () => {
  test("accepts whole numbers", () => {
    expect(isDigits("0")).toBe(true);
    expect(isDigits("123")).toBe(true);
  });
  test("rejects everything else", () => {
    for (const s of ["", "-1", "1.5", "12a", " 1"]) expect(isDigits(s)).toBe(false);
  });
});
