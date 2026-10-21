import { expect, test } from "bun:test";
import type { ChangedFile } from "./changedFile.ts";
import { kindForDiff, reviewOf, TASK_KINDS, type TaskKind } from "./kind.ts";

const changed = (path: string, lines: number): ChangedFile => ({ path, added: lines, removed: 0 });

/** `count` code files of `lines` added lines each. */
const codeFiles = (count: number, lines: number): ChangedFile[] =>
  Array.from({ length: count }, (_, i) => changed(`src/f${i}.ts`, lines));

test("the kinds run from the shortest flow to the longest", () => {
  expect(TASK_KINDS).toEqual(["docs", "small", "normal", "large"]);
});

const SHORT_KINDS: TaskKind[] = ["docs", "small"];

test.each(SHORT_KINDS)(
  "a %s review has no extra lenses, one review round and the fast tier",
  (kind) => {
    expect(reviewOf({ kind, lenses: ["security"], tier: "full" })).toEqual({
      lenses: [],
      tier: "fast",
      reviews: 1,
    });
  },
);

test("a normal review keeps the plan's lenses and tier with three review rounds", () => {
  expect(reviewOf({ kind: "normal", lenses: ["contract"], tier: "full" })).toEqual({
    lenses: ["contract"],
    tier: "full",
    reviews: 3,
  });
});

test("a large review has every lens, the full tier and three review rounds", () => {
  expect(reviewOf({ kind: "large", lenses: [], tier: "fast" })).toEqual({
    lenses: ["security", "contract"],
    tier: "full",
    reviews: 3,
  });
});

test("a small diff inside the small limits stays small", () => {
  expect(kindForDiff({ kind: "small", files: codeFiles(5, 20) })).toBe("small");
});

test("a small diff over the small line limit is normal", () => {
  expect(kindForDiff({ kind: "small", files: codeFiles(2, 51) })).toBe("normal");
});

test("a small diff over the small file limit is normal", () => {
  expect(kindForDiff({ kind: "small", files: codeFiles(6, 1) })).toBe("normal");
});

test("a normal diff over the normal limits is large", () => {
  expect(kindForDiff({ kind: "normal", files: codeFiles(21, 1) })).toBe("large");
  expect(kindForDiff({ kind: "normal", files: codeFiles(1, 401) })).toBe("large");
});

test("a large diff has no limit", () => {
  expect(kindForDiff({ kind: "large", files: codeFiles(500, 1000) })).toBe("large");
});

test("a docs diff of Markdown files only stays docs, at any size", () => {
  const files = [changed("README.md", 900), changed("docs/design.md", 50)];
  expect(kindForDiff({ kind: "docs", files })).toBe("docs");
});

test("a docs diff that touches code is the smallest kind it fits", () => {
  const files = [changed("README.md", 10), changed("cli/main.ts", 3)];
  expect(kindForDiff({ kind: "docs", files })).toBe("small");
});

test("a diff is never given a kind below the given one", () => {
  expect(kindForDiff({ kind: "normal", files: [changed("README.md", 1)] })).toBe("normal");
});
