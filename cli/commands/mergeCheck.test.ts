import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { tenbox } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

interface Pr {
  number: number;
  branch: string;
  base: string;
}

const MANIFEST = `project: demo
setup: echo ready > setup.txt
checks:
  unit: cat out.txt; ! grep -q FAIL out.txt
  second: "true"
`;

let project: TempProject;
let origin: string;
let env: Record<string, string>;

beforeEach(async () => {
  project = await makeTempProject({
    "tenbox.yaml": MANIFEST,
    "out.txt": "fine\n",
    "shared.txt": "base\n",
  });
  origin = await mkdtemp(path.join(os.tmpdir(), "tenbox-origin-"));
  await git.run(["init", "-q", "--bare", origin], project.mainDir);
  await git.run(["remote", "add", "origin", origin], project.mainDir);
  await git.run(["push", "-q", "origin", "main"], project.mainDir);
});

afterEach(async () => {
  await rm(origin, { recursive: true, force: true });
  await project.remove();
});

/** Commits `changes` on a new branch off `from` and pushes it, then returns to main. */
async function pushBranch(name: string, changes: Record<string, string>, from = "main") {
  const dir = project.mainDir;
  await git.run(["checkout", "-q", "-b", name, from], dir);
  for (const [file, text] of Object.entries(changes)) await files.write(path.join(dir, file), text);
  await git.run(["add", "-A"], dir);
  await git.run(["commit", "-q", "-m", name], dir);
  await git.run(["push", "-q", "origin", name], dir);
  await git.run(["checkout", "-q", "main"], dir);
}

/** A fake `gh` whose `pr list` prints the PRs into the `--base` of the call. */
async function fakeGh(prs: Pr[]): Promise<void> {
  const bin = path.join(project.root, "bin");
  const rows = prs.map(
    (p) => `${p.base} ${JSON.stringify({ number: p.number, headRefName: p.branch })}`,
  );
  const script = `#!/bin/sh
base=""
while [ $# -gt 0 ]; do if [ "$1" = "--base" ]; then base="$2"; fi; shift; done
printf '['
sep=""
while read -r b json; do
  if [ "$b" = "$base" ]; then printf '%s%s' "$sep" "$json"; sep=","; fi
done <<'ROWS'
${rows.join("\n")}
ROWS
printf ']'
`;
  await files.write(path.join(bin, "gh"), script);
  await chmod(path.join(bin, "gh"), 0o755);
  env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

const run = (args: string[] = []) => tenbox(["merge-check", ...args], project.mainDir, env);

async function expectNoExtraWorktree(): Promise<void> {
  const list = await git.run(["worktree", "list", "--porcelain"], project.mainDir);
  expect(list.split("\n").filter((l) => l.startsWith("worktree "))).toHaveLength(1);
}

test("two branches that change the same line conflict on the second one", async () => {
  await pushBranch("feat/T-1", { "shared.txt": "one\n" });
  await pushBranch("feat/T-2", { "shared.txt": "two\n" });
  await fakeGh([
    { number: 9, branch: "feat/T-2", base: "main" },
    { number: 4, branch: "feat/T-1", base: "main" },
  ]);
  const result = await run();
  expect([result.code, result.json.ok, result.json.code]).toEqual([1, false, "merge-conflict"]);
  expect(result.json.details).toMatchObject({
    order: ["feat/T-1", "feat/T-2"],
    conflict: { branch: "feat/T-2", files: ["shared.txt"] },
  });
  await expectNoExtraWorktree();
});

test("two clean branches that pass are merged in PR order", async () => {
  await pushBranch("feat/T-1", { "a.txt": "a\n" });
  await pushBranch("feat/T-2", { "b.txt": "b\n" });
  await fakeGh([
    { number: 9, branch: "feat/T-2", base: "main" },
    { number: 4, branch: "feat/T-1", base: "main" },
  ]);
  const result = await run();
  expect([result.code, result.json.ok]).toEqual([0, true]);
  expect(result.json.order).toEqual(["feat/T-1", "feat/T-2"]);
  expect(result.json.prs).toEqual([
    { number: 9, branch: "feat/T-2" },
    { number: 4, branch: "feat/T-1" },
  ]);
  expect(result.json.checks).toMatchObject([
    { name: "unit", new_failures: [] },
    { name: "second", new_failures: [] },
  ]);
  await expectNoExtraWorktree();
});

test("a merge that adds a failure line is a new failure", async () => {
  await pushBranch("feat/T-1", { "out.txt": " FAIL  broken\n" });
  await fakeGh([{ number: 1, branch: "feat/T-1", base: "main" }]);
  const result = await run();
  expect([result.code, result.json.ok, result.json.code]).toEqual([1, false, "new-failures"]);
  expect(JSON.stringify(result.json.details)).toContain("FAIL  broken");
  await expectNoExtraWorktree();
});

test("a PR whose branch is not a task branch is not merged and not listed", async () => {
  await pushBranch("feat/T-1", { "a.txt": "a\n" });
  await pushBranch("dependabot/x", { "out.txt": " FAIL  broken\n" });
  await fakeGh([
    { number: 1, branch: "feat/T-1", base: "main" },
    { number: 2, branch: "dependabot/x", base: "main" },
  ]);
  const result = await run();
  expect([result.code, result.json.ok]).toEqual([0, true]);
  expect(result.json.prs).toEqual([{ number: 1, branch: "feat/T-1" }]);
});

test("--base dev merges onto origin/dev and lists only the PRs into dev", async () => {
  await git.run(["branch", "dev", "main"], project.mainDir);
  await git.run(["push", "-q", "origin", "dev"], project.mainDir);
  await pushBranch("feat/T-1", { "a.txt": "a\n" });
  await pushBranch("feat/T-2", { "b.txt": "b\n" }, "dev");
  await fakeGh([
    { number: 1, branch: "feat/T-1", base: "main" },
    { number: 2, branch: "feat/T-2", base: "dev" },
  ]);
  const result = await run(["--base", "dev"]);
  expect([result.code, result.json.ok]).toEqual([0, true]);
  expect(result.json.prs).toEqual([{ number: 2, branch: "feat/T-2" }]);
  expect(result.json.base).toMatchObject({ ref: "origin/dev" });
});

test("a failed setup is the error setup and the worktree is removed", async () => {
  await pushBranch("feat/T-1", {
    "tenbox.yaml": MANIFEST.replace("echo ready > setup.txt", "exit 3"),
  });
  await fakeGh([{ number: 1, branch: "feat/T-1", base: "main" }]);
  const result = await run();
  expect([result.code, result.json.ok, result.json.code]).toEqual([1, false, "setup"]);
  await expectNoExtraWorktree();
});

test("with no open task PR it prints ok and adds no worktree", async () => {
  await fakeGh([]);
  const result = await run();
  expect([result.code, result.json.ok, result.json.prs, result.json.checks]).toEqual([
    0,
    true,
    [],
    [],
  ]);
  await expectNoExtraWorktree();
});

const TIERED_MANIFEST = `project: demo
setup: echo ready > setup.txt
checks:
  fast:
    first: "true"
  full:
    slow: cat out.txt; ! grep -q FAIL out.txt
`;

test("merge-check runs the checks of both tiers", async () => {
  await pushBranch("feat/T-1", { "tenbox.yaml": TIERED_MANIFEST });
  await fakeGh([{ number: 1, branch: "feat/T-1", base: "main" }]);
  const result = await run();
  expect([result.code, result.json.ok]).toEqual([0, true]);
  expect(result.json.checks).toMatchObject([{ name: "first" }, { name: "slow" }]);
});

test("a new failure in a full check fails merge-check", async () => {
  await pushBranch("feat/T-1", { "tenbox.yaml": TIERED_MANIFEST, "out.txt": " FAIL  broken\n" });
  await fakeGh([{ number: 1, branch: "feat/T-1", base: "main" }]);
  const result = await run();
  expect([result.code, result.json.code]).toEqual([1, "new-failures"]);
  expect(JSON.stringify(result.json.details)).toContain("FAIL  broken");
});
