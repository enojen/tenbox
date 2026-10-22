import { describe, expect, test } from "bun:test";
import { badFileError, badInputError } from "./tasks.ts";

describe("badFileError", () => {
  test("names the file and its issues, with code bad-file", () => {
    const error = badFileError(".tenbox/plan.json", ["parts: required", "kind: invalid"]);
    expect(error.message).toBe(".tenbox/plan.json is not valid: parts: required; kind: invalid");
    expect(error.code).toBe("bad-file");
    expect(error.details).toEqual(["parts: required", "kind: invalid"]);
  });
});

describe("badInputError", () => {
  test("names the input and its issues, with code bad-input", () => {
    const error = badInputError("the build result", ["status: required"]);
    expect(error.message).toBe("the build result is not valid: status: required");
    expect(error.code).toBe("bad-input");
    expect(error.details).toEqual(["status: required"]);
  });
});
