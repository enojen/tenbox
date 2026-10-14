import { describe, expect, test } from "bun:test";
import { mergeManifest, type TrackerConfig } from "./manifest.ts";
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
    expect(m.checks).toEqual({ fast: { unit: "bun test --bail" }, full: {} });
    expect(m.tracker).toEqual({ kind: "linear", api_key: "k" });
    expect("services" in m).toBe(false);
  });
  test("clickup is a tracker kind with optional status names", () => {
    const tracker: TrackerConfig = { kind: "clickup", statuses: { in_progress: "doing" } };
    const m = mergeManifest([{ file: "tenbox.yaml", value: { tracker } }]);
    expect(m.tracker).toEqual(tracker);
  });
  test("a blank tracker status name is a manifest error", () => {
    const tracker = { kind: "clickup", statuses: { done: "" } };
    expect(() => mergeManifest([{ file: "tenbox.yaml", value: { tracker } }])).toThrow(
      /tracker\.statuses\.done/,
    );
  });
  test("empty gives defaults", () => {
    const m = mergeManifest([]);
    expect(m.checks).toEqual({ fast: {}, full: {} });
    expect(m.tracker.kind).toBe("none");
    expect(m.base).toBe("main");
  });
  test("checks take the two tiers; the flat form is the fast tier", () => {
    const tiers = { fast: { a: "x" }, full: { b: "y" } };
    const tiered = mergeManifest([{ file: "tenbox.yaml", value: { checks: tiers } }]);
    expect(tiered.checks).toEqual(tiers);
    const onlyFull = mergeManifest([
      { file: "tenbox.yaml", value: { checks: { full: { b: "y" } } } },
    ]);
    expect(onlyFull.checks).toEqual({ fast: {}, full: { b: "y" } });
  });
  test("a flat layer and a tiered layer merge into the tiers", () => {
    const flat = { file: "tenbox.yaml", value: { checks: { lint: "x" } } };
    const tiered = { file: "tenbox.local.yaml", value: { checks: { full: { e2e: "y" } } } };
    const expected = { fast: { lint: "x" }, full: { e2e: "y" } };
    expect(mergeManifest([flat, tiered]).checks).toEqual(expected);
    expect(mergeManifest([tiered, flat]).checks).toEqual(expected);
  });
  test("a check name in both tiers is a manifest error naming it", () => {
    const checks = { fast: { lint: "x" }, full: { lint: "y" } };
    expect(() => mergeManifest([{ file: "tenbox.yaml", value: { checks } }])).toThrow(/lint/);
  });
  test("bad values are reported with their path", () => {
    expect(() => mergeManifest([{ file: "tenbox.yaml", value: { checks: { unit: 42 } } }])).toThrow(
      /checks\.fast\.unit/,
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
    expect(mergeManifest([]).names).toEqual({ branch: "feat/{id}", session: "tenbox-{id}" });
  });
  test("one {id} each, the branch safe for git", () => {
    expect(
      mergeManifest([{ file: "tenbox.yaml", value: { names: { branch: "task/{id}" } } }]).names
        .branch,
    ).toBe("task/{id}");
    for (const branch of ["feat/", "feat/{id}/{id}", "feat/{id}..x", "feat {id}"]) {
      expect(() => mergeManifest([{ file: "tenbox.yaml", value: { names: { branch } } }])).toThrow(
        /names\.branch/,
      );
    }
    for (const session of ["tb", "{id}-{id}"]) {
      expect(() => mergeManifest([{ file: "tenbox.yaml", value: { names: { session } } }])).toThrow(
        /names\.session/,
      );
    }
    const dotted = { file: "tenbox.yaml", value: { names: { session: "tb.{id}" } } };
    expect(mergeManifest([dotted]).names.session).toBe("tb.{id}");
  });
  test("an unknown key, such as the old tmux, is an error", () => {
    const old = { file: "tenbox.yaml", value: { names: { tmux: "tb-{id}" } } };
    expect(() => mergeManifest([old])).toThrow(/names.*tmux/);
  });
});

test("project name cannot leave the worktree root", () => {
  expect(() => mergeManifest([{ file: "tenbox.yaml", value: { project: "../x" } }])).toThrow(
    /project: letters, digits, _ and - only/,
  );
});

describe("id", () => {
  const load = (id: unknown) => mergeManifest([{ file: "tenbox.yaml", value: { id } }]);
  test("a valid id loads", () => {
    expect(String(load("k7f3qa").id)).toBe("k7f3qa");
  });
  test("no id gives undefined", () => {
    expect(mergeManifest([]).id).toBeUndefined();
  });
  test("a bad id fails with the key and the rule", () => {
    for (const id of ["K7F3QA", "k7f3q", "k7f3qa1", "k7-3qa"]) {
      expect(() => load(id)).toThrow(/id: 6 characters, a-z and 0-9/);
    }
  });
});

test("notify takes a ntfy URL; no notify means none", () => {
  const url = "https://ntfy.example.com/tenbox";
  const set = mergeManifest([{ file: "tenbox.yaml", value: { notify: { ntfy: url } } }]);
  expect(set.notify).toEqual({ ntfy: url });
  expect(mergeManifest([]).notify).toEqual({});
  expect(() => mergeManifest([{ file: "tenbox.yaml", value: { notify: { ntfy: "x" } } }])).toThrow(
    /notify\.ntfy/,
  );
  expect(() =>
    mergeManifest([{ file: "tenbox.yaml", value: { notify: { desktop: true } } }]),
  ).toThrow(/notify/);
});
