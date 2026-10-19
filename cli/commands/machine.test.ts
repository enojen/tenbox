import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const USAGE_EXIT = 2;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const RUN_URL = "https://github.com/o/r/actions/runs/123";

let project: TempProject;
let claudeDir: string;
let calls: string;
let env: Record<string, string>;

const FAKE_GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_CALLS"
if [ "$1" = run ]; then
  echo '[{"databaseId":7,"displayTitle":"T-1 build","status":"completed","conclusion":"success","url":"u","createdAt":"2026-01-01T00:00:00Z"}]'
else
  echo "${RUN_URL}"
fi
`;

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  claudeDir = path.join(project.root, "claude");
  calls = path.join(project.root, "gh.calls");
  const bin = path.join(project.root, "bin");
  await files.write(path.join(bin, "gh"), FAKE_GH);
  await chmod(path.join(bin, "gh"), 0o755);
  env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GH_CALLS: calls,
    CLAUDE_CONFIG_DIR: claudeDir,
  };
});

afterEach(() => project.remove());

const writeLogin = (expiresAt: number) =>
  files.write(
    path.join(claudeDir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "SECRET", refreshTokenExpiresAt: expiresAt } }),
  );

const ghCalls = async () => {
  const text = await files.read(calls);
  return text ?? "";
};
const machine = (args: string[]) => tenbox(["machine", ...args], project.mainDir, env);

describe("machine run", () => {
  test("a valid login starts machine.yml and prints the run url", async () => {
    await writeLogin(Date.now() + DAY_MS);
    const run = await machine(["run", "TEN-1", "--", "tenbox", "build", "TEN-1"]);
    expect(run.code).toBe(0);
    expect(run.json).toEqual({ ok: true, task: "TEN-1", cmd: "build", url: RUN_URL });
    const logged = await ghCalls();
    expect(logged).toBe("workflow run machine.yml -f task=TEN-1 -f cmd=build\n");
  });

  test("an expired refresh token is login-expired, mentions /login and never calls gh", async () => {
    await writeLogin(Date.now() - MINUTE_MS);
    const run = await machine(["run", "TEN-1", "--", "tenbox", "build", "TEN-1"]);
    expect([run.code, run.json.code]).toEqual([1, "login-expired"]);
    expect(String(run.json.error)).toContain("/login");
    expect(run.out).not.toContain("SECRET");
    const logged = await ghCalls();
    expect(logged).toBe("");
  });

  test("a missing .credentials.json is no-login and never calls gh", async () => {
    const run = await machine(["run", "TEN-1", "--", "tenbox", "build", "TEN-1"]);
    expect([run.code, run.json.code]).toEqual([1, "no-login"]);
    const logged = await ghCalls();
    expect(logged).toBe("");
  });

  test("start passes the project, the origin url and the title", async () => {
    await writeLogin(Date.now() + DAY_MS);
    await git.run(["remote", "add", "origin", "https://github.com/o/demo.git"], project.mainDir);
    const words = ["tenbox", "start", "TEN-1", "--title", "Fix it"];
    const run = await machine(["run", "TEN-1", "--", ...words]);
    expect(run.code).toBe(0);
    const logged = await ghCalls();
    expect(logged).toBe(
      "workflow run machine.yml -f task=TEN-1 -f cmd=start -f project=demo -f repo=https://github.com/o/demo.git -f title=Fix it\n",
    );
  });

  test("start strips a token from the origin url", async () => {
    await writeLogin(Date.now() + DAY_MS);
    const origin = "https://x-access-token:ghp_secret@github.com/o/demo.git";
    await git.run(["remote", "add", "origin", origin], project.mainDir);
    const run = await machine(["run", "TEN-1", "--", "tenbox", "start", "TEN-1"]);
    expect(run.code).toBe(0);
    expect(await ghCalls()).toBe(
      "workflow run machine.yml -f task=TEN-1 -f cmd=start -f project=demo -f repo=https://github.com/o/demo.git\n",
    );
  });

  test("close --force adds force=true; close alone does not", async () => {
    await writeLogin(Date.now() + DAY_MS);
    await machine(["run", "TEN-1", "--", "tenbox", "close", "TEN-1", "--force"]);
    await machine(["run", "TEN-1", "--", "tenbox", "close", "TEN-1"]);
    const logged = await ghCalls();
    expect(logged).toBe(
      [
        "workflow run machine.yml -f task=TEN-1 -f cmd=close -f force=true",
        "workflow run machine.yml -f task=TEN-1 -f cmd=close",
        "",
      ].join("\n"),
    );
  });

  test.each([
    ["another id", ["run", "TEN-1", "--", "tenbox", "build", "TEN-2"]],
    ["another command", ["run", "TEN-1", "--", "tenbox", "check", "TEN-1"]],
    ["no --", ["run", "TEN-1"]],
    ["words without --", ["run", "TEN-1", "tenbox", "build", "TEN-1"]],
  ])("%s is a usage error before gh runs", async (_name, args) => {
    await writeLogin(Date.now() + DAY_MS);
    const run = await machine(args);
    expect([run.code, run.json.code]).toEqual([USAGE_EXIT, "usage"]);
    const logged = await ghCalls();
    expect(logged).toBe("");
  });
});

describe("machine ls", () => {
  test("lists the runs of machine.yml", async () => {
    const run = await machine(["ls"]);
    expect(run.json).toEqual({
      ok: true,
      runs: [
        {
          id: 7,
          title: "T-1 build",
          status: "completed",
          conclusion: "success",
          url: "u",
          created: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const logged = await ghCalls();
    expect(logged).toContain("run list --workflow machine.yml --json");
  });
});
