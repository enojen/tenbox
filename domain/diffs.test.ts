import { expect, test } from "bun:test";
import { type DiffFile, mergeDiffs } from "./diffs.ts";

const changed = (path: string, lines: number): DiffFile => ({ path, added: lines, removed: 0 });

test("a path in two diffs counts once, at its larger change", () => {
  const merged = mergeDiffs([
    [changed("a.ts", 10), changed("b.ts", 1)],
    [changed("a.ts", 30), changed("c.ts", 2)],
  ]);
  expect(merged).toEqual([changed("a.ts", 30), changed("b.ts", 1), changed("c.ts", 2)]);
});
