import { expect, test } from "bun:test";
import { countParts, partIdOf, readPartStatus } from "./part.ts";

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
