import { afterEach, expect, spyOn, test } from "bun:test";
import { processes } from "../infra/processes.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { projects } from "./projects.ts";

let project: TempProject;

afterEach(async () => {
  await project.remove();
});

test("get runs git rev-parse --git-common-dir once", async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  const run = spyOn(processes, "run");
  try {
    await projects.get(project.mainDir);
    const commonDirCalls = run.mock.calls.filter(([cmd]) => cmd.includes("--git-common-dir"));
    expect(commonDirCalls).toHaveLength(1);
  } finally {
    run.mockRestore();
  }
});
