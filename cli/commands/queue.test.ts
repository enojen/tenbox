import { afterEach, expect, test } from "bun:test";
import { tenbox } from "../test/cli.ts";
import { installFakeGh } from "../test/fakeGh.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

let project: TempProject;

afterEach(async () => {
  await project.remove();
});

test("without a tracker it fails with no-tracker", async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  const run = await tenbox(["queue", "T-1"], project.mainDir);
  expect([run.code, run.json.code]).toEqual([1, "no-tracker"]);
});

test("a tracker without a queued status skips it and prints the tracker step", async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\ntracker: { kind: github }\n" });
  const gh = await installFakeGh();
  const run = await tenbox(["queue", "7"], project.mainDir, gh.env);
  expect(run.json).toEqual({
    ok: true,
    task: "7",
    tracker: { kind: "github", status: "skipped" },
  });
});

test("without an id it is a usage error", async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  const run = await tenbox(["queue"], project.mainDir);
  expect([run.code, run.json.code]).toEqual([2, "usage"]);
});
