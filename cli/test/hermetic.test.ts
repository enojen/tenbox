import { expect, test } from "bun:test";
import { processes } from "../infra/processes.ts";

test("a test reaches no real claude, gh or docker, only the fakes it puts in PATH", () => {
  expect(["claude", "gh", "docker"].map((tool) => processes.which(tool))).toEqual([
    null,
    null,
    null,
  ]);
});
