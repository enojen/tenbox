import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { durations, hashes, jsons, objects, strings } from "./utils.ts";

describe("strings.isWholeNumber", () => {
  test("accepts whole numbers", () => {
    expect(strings.isWholeNumber("0")).toBe(true);
    expect(strings.isWholeNumber("123")).toBe(true);
  });
  test("rejects everything else", () => {
    for (const s of ["", "-1", "1.5", "12a", " 1"]) expect(strings.isWholeNumber(s)).toBe(false);
  });
});

test("durations.minutesBetween rounds to one decimal and is null without a time", () => {
  expect(durations.minutesBetween("2026-01-01T00:00:00Z", "2026-01-01T00:01:30Z")).toBe(1.5);
  expect(durations.minutesBetween(null, "2026-01-01T00:00:00Z")).toBeNull();
});

describe("hashes.sha256Hex", () => {
  test("gives the SHA-256 of the text in hex", () => {
    expect(hashes.sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("jsons.parse", () => {
  test("returns the parsed value, arrays included", () => {
    expect(jsons.parse('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(jsons.parse("null")).toBeNull();
  });
  test("returns undefined when the text is not JSON", () => {
    expect(jsons.parse("{nope")).toBeUndefined();
  });
});

describe("jsons.check", () => {
  const Shape = z.object({ id: z.string() });

  test("gives the value when the text is JSON of the shape", () => {
    expect(jsons.check(Shape, '{"id":"a"}')).toEqual({ ok: true, value: { id: "a" } });
  });
  test("gives the issues when the JSON does not fit the shape", () => {
    expect(jsons.check(Shape, '{"id":1}')).toEqual({
      ok: false,
      issues: ["id: Invalid input: expected string, received number"],
    });
  });
  test("says not JSON when the text is not JSON", () => {
    expect(jsons.check(Shape, "{nope")).toEqual({ ok: false, issues: ["not JSON"] });
  });
});

describe("jsons.checkLines", () => {
  const Shape = z.object({ id: z.string() });

  test("gives the lines that fit the shape; empty lines are not lines", () => {
    expect(jsons.checkLines(Shape, '{"id":"a"}\n\n{"id":"b"}\n')).toEqual({
      values: [{ id: "a" }, { id: "b" }],
      skipped: 0,
    });
  });
  test("counts a line that is not JSON or does not fit the shape as skipped", () => {
    expect(jsons.checkLines(Shape, '{"id":"a"}\n{nope\n{"id":1}\n')).toEqual({
      values: [{ id: "a" }],
      skipped: 2,
    });
  });
  test("does not count a half-written last line, one with no newline after it", () => {
    expect(jsons.checkLines(Shape, '{"id":"a"}\n{"id":"b')).toEqual({
      values: [{ id: "a" }],
      skipped: 0,
    });
  });
  test("keeps a whole last line with no newline after it", () => {
    expect(jsons.checkLines(Shape, '{"id":"a"}')).toEqual({ values: [{ id: "a" }], skipped: 0 });
  });
});

describe("objects.isRecord", () => {
  test("is true for an object, also an empty one", () => {
    expect(objects.isRecord({ a: 1 })).toBe(true);
    expect(objects.isRecord({})).toBe(true);
  });
  test("is false for null, an array and a value that is not an object", () => {
    for (const value of [null, undefined, [1], "a", 1, true]) {
      expect(objects.isRecord(value)).toBe(false);
    }
  });
});
