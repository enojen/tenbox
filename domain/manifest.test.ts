import { describe, expect, test } from "bun:test";
import { mergeManifest } from "./manifest.ts";
import { deepMerge } from "./utils.ts";

test("deepMerge: objects merge, arrays replace", () => {
  expect(deepMerge({ a: { x: 1, y: 2 }, l: [1] }, { a: { y: 3 }, l: [2] })).toEqual({
    a: { x: 1, y: 3 },
    l: [2],
  });
});

describe("mergeManifest", () => {
  test("layers, defaults, later-phase keys dropped", () => {
    const m = mergeManifest([
      {
        file: "tenbox.yaml",
        value: {
          project: "demo",
          checks: { unit: "bun test" },
          tracker: { kind: "linear" },
          services: { api: {} },
        },
      },
      { file: "tenbox.local.yaml", value: { tracker: { api_key: "k" } } },
      { file: "override.yaml", value: { checks: { unit: "bun test --bail" } } },
    ]);
    expect(m.project).toBe("demo");
    expect(m.checks).toEqual({ unit: "bun test --bail" });
    expect(m.tracker).toEqual({ kind: "linear", api_key: "k" });
    expect("services" in m).toBe(false);
  });
  test("empty gives defaults", () => {
    const m = mergeManifest([]);
    expect(m.checks).toEqual({});
    expect(m.tracker.kind).toBe("none");
    expect(m.base).toBe("main");
  });
  test("bad values are reported with their path", () => {
    expect(() => mergeManifest([{ file: "tenbox.yaml", value: { checks: { unit: 42 } } }])).toThrow(
      /checks\.unit/,
    );
    expect(() => mergeManifest([{ file: "tenbox.yaml", value: [1] }])).toThrow(/mapping/);
  });
});

test("failure_pattern must compile", () => {
  expect(
    mergeManifest([{ file: "tenbox.yaml", value: { failure_pattern: "FAILED" } }]).failure_pattern,
  ).toBe("FAILED");
  expect(() => mergeManifest([{ file: "tenbox.yaml", value: { failure_pattern: "(" } }])).toThrow(
    /failure_pattern: not a valid regular expression/,
  );
});

describe("names", () => {
  test("defaults", () => {
    expect(mergeManifest([]).names).toEqual({ branch: "feat/{id}", tmux: "tenbox-{id}" });
  });
  test("one {id} each, safe for git and tmux", () => {
    expect(
      mergeManifest([{ file: "tenbox.yaml", value: { names: { branch: "task/{id}" } } }]).names
        .branch,
    ).toBe("task/{id}");
    for (const branch of ["feat/", "feat/{id}/{id}", "feat/{id}..x", "feat {id}"]) {
      expect(() => mergeManifest([{ file: "tenbox.yaml", value: { names: { branch } } }])).toThrow(
        /names\.branch/,
      );
    }
    for (const tmux of ["tb.{id}", "tb:{id}", "tb"]) {
      expect(() => mergeManifest([{ file: "tenbox.yaml", value: { names: { tmux } } }])).toThrow(
        /names\.tmux/,
      );
    }
  });
});

test("project name cannot leave the worktree root", () => {
  expect(() => mergeManifest([{ file: "tenbox.yaml", value: { project: "../x" } }])).toThrow(
    /project: letters, digits, _ and - only/,
  );
});
