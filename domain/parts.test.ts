import { expect, test } from "bun:test";
import {
  countParts,
  findStaleParts,
  partIdOf,
  readPartFiles,
  readPartStatus,
  reopenPart,
} from "./parts.ts";

test("partIdOf takes the NN prefix of a part file name", () => {
  expect(partIdOf("01-proofs-points.md")).toBe("01");
  expect(partIdOf("01-users-tokens-auth")).toBe("01");
  expect(partIdOf("01")).toBe("01");
  expect(partIdOf("notes.md")).toBe("notes");
});

test("readPartStatus reads the status line and takes todo for a missing or unknown one", () => {
  expect(readPartStatus("# 01 · x\nstatus: doing\nfiles: a\n")).toBe("doing");
  expect(readPartStatus("# 01 · x\nstatus: blocked\n")).toBe("blocked");
  expect(readPartStatus("# 01 · x\nfiles: a\n")).toBe("todo");
  expect(readPartStatus("# 01 · x\nstatus: finished\n")).toBe("todo");
});

test("countParts counts each status, with zero for the ones not seen", () => {
  expect(countParts(["done", "done", "todo", "blocked"])).toEqual({
    todo: 1,
    doing: 0,
    done: 2,
    blocked: 1,
  });
  expect(countParts([])).toEqual({ todo: 0, doing: 0, done: 0, blocked: 0 });
});

const DONE_PART =
  "# 01 · x\nstatus: done\nfiles: a.txt\nacceptance:\n- a is built\nresult: built x; commit abc\n";

test("reopenPart sets todo, adds the acceptance line and keeps the old result as history", () => {
  const reopened = reopenPart({ text: DONE_PART, accept: "x is checked" });
  expect(reopened).toBe(
    "# 01 · x\nstatus: todo\nfiles: a.txt\nacceptance:\n- a is built\n- x is checked\nhistory: built x; commit abc\nresult:\n",
  );
});

test("reopenPart twice keeps both results as history lines", () => {
  const once = reopenPart({ text: DONE_PART, accept: "b" });
  const twice = reopenPart({ text: once.replace("result:", "result: second"), accept: "c" });
  expect(twice).toBe(
    "# 01 · x\nstatus: todo\nfiles: a.txt\nacceptance:\n- a is built\n- b\n- c\nhistory: built x; commit abc\nhistory: second\nresult:\n",
  );
});

test("reopenPart adds an acceptance block before result when the file has none", () => {
  const reopened = reopenPart({ text: "# 01 · x\nstatus: done\nresult:\n", accept: "a" });
  expect(reopened).toBe("# 01 · x\nstatus: todo\nacceptance:\n- a\nresult:\n");
});

test("readPartFiles splits the files line on commas", () => {
  expect(readPartFiles("# 01\nfiles: a.ts, b.ts ,c.ts\n")).toEqual(["a.ts", "b.ts", "c.ts"]);
  expect(readPartFiles("# 01\nstatus: todo\n")).toEqual([]);
});

test("findStaleParts names files that differ, parts with no file and files not in the plan", () => {
  const stale = findStaleParts({
    planParts: [
      { id: "01", difficulty: "easy", files: ["b.txt"] },
      { id: "02", difficulty: "easy" },
      { id: "04", difficulty: "easy", files: ["a.txt", "c.txt"] },
    ],
    partFiles: [
      { part: "01", file: "01-a.md", files: ["a.txt"] },
      { part: "03", file: "03-old.md", files: [] },
      { part: "04", file: "04-d.md", files: ["c.txt", "a.txt"] },
    ],
  });
  expect(stale).toEqual([
    { part: "01", file: "01-a.md", reason: "files differ" },
    { part: "02", file: null, reason: "no part file" },
    { part: "03", file: "03-old.md", reason: "not in the plan" },
  ]);
});
