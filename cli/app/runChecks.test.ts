import { describe, expect, test } from "bun:test";
import { failureLine } from "../domain/failures.ts";
import { taskId } from "../domain/ids.ts";
import { fakePorts } from "../test/fakes.ts";
import { runChecks } from "./runChecks.ts";

const MAIN = "/wt/demo/main";
const TASK = "/wt/demo/T-1";
const BASE = "b".repeat(40);
const HEAD = "c".repeat(40);
const lines = (...xs: string[]) => xs.map(failureLine);
const META = { date: "2026-01-01T00:00:00.000Z", cmd: "bun test", exit_code: 1 };

function ports(outputs: { task: string; main: string; mainSha?: string }) {
  const p = fakePorts({
    cwd: TASK,
    wtRoot: "/wt",
    git: (args, cwd) => {
      const a = args.join(" ");
      if (a === "rev-parse --show-toplevel") return cwd;
      if (a === "rev-parse --abbrev-ref HEAD") return cwd === TASK ? "feat/T-1" : "main";
      if (a === "rev-parse --git-common-dir") return `${MAIN}/.git`;
      if (a === "rev-parse HEAD") return cwd === TASK ? HEAD : (outputs.mainSha ?? BASE);
      if (a === "merge-base HEAD main") return BASE;
      return null;
    },
    shell: (_c, cwd) => ({ code: 1, output: cwd === TASK ? outputs.task : outputs.main, timedOut: false }),
  });
  p.files.seed({ [`${TASK}/tenbox.yaml`]: "project: demo\nchecks: { unit: bun test }\n" });
  p.files.dirs.add(TASK);
  return p;
}

describe("runChecks", () => {
  test("no baseline yet: takes one in main, old failures are not new", async () => {
    const p = ports({ task: " FAIL  old\n", main: " FAIL  old\n" });
    const r = await runChecks(p, { id: taskId("T-1"), base: "main", timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    expect(r.round).toBe(1);
    expect(r.checks[0]).toMatchObject({ name: "unit", failures: 1, new_failures: [], baseline: { sha: BASE, source: "main", failures: 1 } });
    expect(p.shell.calls.map((c) => c.cwd)).toEqual([TASK, MAIN]);
    expect(p.baselines.saved).toEqual([{ project: "demo", check: "unit", baseline: { sha: BASE, lines: lines("FAIL  old") }, meta: { date: expect.any(String), cmd: "bun test", exit_code: 1 } }]);
    expect(await p.files.read(`${TASK}/.tenbox/rounds/1/checks.json`)).toContain('"ok": true');
  });

  test("exact baseline present: a new line fails, round continues", async () => {
    const p = ports({ task: " FAIL  old\n FAIL  new\n", main: "" });
    await p.baselines.save("demo", "unit", { sha: BASE, lines: lines("FAIL  old") }, META);
    p.files.dirs.add(`${TASK}/.tenbox/rounds/1`);
    const r = await runChecks(p, { id: taskId("T-1"), base: "main", timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(r.round).toBe(2);
    expect(r.checks[0]).toMatchObject({ new_failures: ["FAIL  new"], fixed: [], baseline: { source: "exact" } });
    expect(r.summary).toBe("unit: 1 new failure(s)\n  FAIL  new");
    expect(p.shell.calls.map((c) => c.cwd)).toEqual([TASK]);
  });

  test("main moved on and no baseline: newest baseline, else none", async () => {
    const p = ports({ task: " FAIL  x\n", main: "", mainSha: "d".repeat(40) });
    await p.baselines.save("demo", "unit", { sha: "old1", lines: lines("FAIL  x") }, META);
    await p.baselines.save("demo", "unit", { sha: "old2", lines: lines() }, META);
    const r = await runChecks(p, { id: taskId("T-1"), base: "main", timeoutMs: 1000, round: 7 });
    expect(r.round).toBe(7);
    expect(r.checks[0]).toMatchObject({ baseline: { sha: "old2", source: "newest", failures: 0 }, new_failures: ["FAIL  x"] });
  });


  test("the manifest's failure_pattern replaces the default", async () => {
    const p = ports({ task: "FooTest > bar() FAILED\n FAIL  ignored\n", main: "" });
    p.files.put(`${TASK}/tenbox.yaml`, "project: demo\nchecks: { unit: ./gradlew test }\nfailure_pattern: '(^|\\s)FAILED(\\s|$)'\n");
    const r = await runChecks(p, { id: taskId("T-1"), base: "main", timeoutMs: 1000 });
    expect(r.checks[0]).toMatchObject({ failures: 1, new_failures: ["FooTest > bar() FAILED"] });
  });
  test("no checks anywhere is an error", async () => {
    const p = ports({ task: "", main: "" });
    p.files.put(`${TASK}/tenbox.yaml`, "project: demo\n");
    await expect(runChecks(p, { id: taskId("T-1"), base: "main", timeoutMs: 1000 })).rejects.toMatchObject({ code: "no-checks" });
  });
});
