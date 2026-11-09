import { expect, test } from "bun:test";
import crypto from "node:crypto";
import { encryption } from "./encryption.ts";

const KEY_BYTES = 32;
const KEY = crypto.randomBytes(KEY_BYTES);
const TEXT = "pk_123_secret";

test("a sealed text opens with the same key and context, and does not hold the text", () => {
  const sealed = encryption.seal({ key: KEY, context: "k7f3qa", text: TEXT });
  expect(sealed).not.toContain(TEXT);
  expect(encryption.open({ key: KEY, context: "k7f3qa", sealed })).toBe(TEXT);
});

test("the same text seals to another value each time", () => {
  const first = encryption.seal({ key: KEY, context: "k7f3qa", text: TEXT });
  const second = encryption.seal({ key: KEY, context: "k7f3qa", text: TEXT });
  expect(first).not.toBe(second);
});

test("another context, another key or a changed value does not open", () => {
  const sealed = encryption.seal({ key: KEY, context: "k7f3qa", text: TEXT });
  const other = crypto.randomBytes(KEY_BYTES);
  expect(encryption.open({ key: KEY, context: "rsgjhl", sealed })).toBeNull();
  expect(encryption.open({ key: other, context: "k7f3qa", sealed })).toBeNull();
  expect(encryption.open({ key: KEY, context: "k7f3qa", sealed: `${sealed}A` })).toBeNull();
  expect(encryption.open({ key: KEY, context: "k7f3qa", sealed: "not sealed" })).toBeNull();
});
