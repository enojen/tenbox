import { expect, test } from "bun:test";
import { tokens } from "./tokens.ts";

test("make gives tbx_ and 64 hex characters, different each time", () => {
  const token = tokens.make();
  expect(token).toMatch(/^tbx_[0-9a-f]{64}$/);
  expect(tokens.make()).not.toBe(token);
});

test("hash is the SHA-256 hex of the token", () => {
  expect(tokens.hash("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
