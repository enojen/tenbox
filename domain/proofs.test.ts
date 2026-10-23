import { expect, test } from "bun:test";
import { readProofs } from "./proofs.ts";

const FILE = "/x/proofs.json";
const PROOF = { part: "01", file: "a.test.ts", test: "t", failure: "boom" };

test("readProofs returns an array of valid proofs", () => {
  expect(readProofs(JSON.stringify([PROOF]), FILE)).toEqual([PROOF]);
});

test.each([
  ["text that is not JSON", "{nope"],
  ["an object", "{}"],
  ["an item that is not a proof", JSON.stringify([{ part: "01" }])],
])("readProofs fails with bad-file for %s", (_name, text) => {
  expect(() => readProofs(text, FILE)).toThrow(expect.objectContaining({ code: "bad-file" }));
});
