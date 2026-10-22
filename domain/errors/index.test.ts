import { describe, expect, test } from "bun:test";
import { errorMessage } from "./index.ts";

describe("errorMessage", () => {
  test("takes the message of an Error and stringifies anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});
