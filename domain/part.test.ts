import { expect, test } from "bun:test";
import { partIdOf } from "./part.ts";

test("partIdOf takes the NN prefix of a part file name", () => {
  expect(partIdOf("01-proofs-points.md")).toBe("01");
  expect(partIdOf("01-users-tokens-auth")).toBe("01");
  expect(partIdOf("01")).toBe("01");
  expect(partIdOf("notes.md")).toBe("notes");
});
