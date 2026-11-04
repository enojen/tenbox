import { afterEach, beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import { type Json, tenbox } from "./cli.ts";
import { makeTempProject, type TempProject } from "./tempProject.ts";
import { runWorkflow, type ScriptedAgent } from "./workflow.ts";

// The workflow tests answer for the CLI; these run the commands the workflow gives its workers
// against the real CLI, so the two cannot drift apart.

const PART_DONE_COMMAND = /`(tenbox part done [^`]*)`/;
const COMMIT_PLACEHOLDER = "<hash of your last commit>";

let project: TempProject;
let worktree: string;

const plan = {
  summary: "s",
  estimated_lines: 1,
  parts: [
    { id: "01", difficulty: "easy", files: ["a.txt"] },
    { id: "02", difficulty: "easy", files: ["b.txt"] },
  ],
  examples: [],
  decisions: [],
  lenses: [],
  questions: [],
};

beforeEach(async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  worktree = path.join(project.wtRoot, "demo", "T-1");
  await tenbox(["start", "T-1", "--title", "x", "--no-claude"], project.mainDir);
  await files.writeJson(path.join(worktree, ".tenbox", "plan.json"), plan);
});

afterEach(async () => {
  await project.remove();
});

const commit = async (name: string): Promise<string> => {
  await files.write(path.join(worktree, name), `${name} ${Math.random()}\n`);
  await git.run(["add", name], worktree);
  await git.run(["commit", "-q", "-m", name], worktree);
  return git.run(["rev-parse", "HEAD"], worktree);
};

/** The file a worker of each part changes; the fix worker changes a file of part 01. */
const PART_FILE: Record<string, string> = { "01": "a.txt", "02": "b.txt", fix: "a.txt" };
const LABEL_PART = /: (\w+)( fix)?$/;

/**
 * A worker that commits a file of its part and runs the `tenbox part done` its prompt names on
 * the real CLI. Its check is green on that commit, so the next `--since` is a real commit.
 */
function cliWorker(partDones: Json[]): ScriptedAgent {
  return async (prompt, options) => {
    const part = options.label.match(LABEL_PART)?.[1] ?? "";
    const sha = await commit(PART_FILE[part] ?? "other.txt");
    const command = prompt.match(PART_DONE_COMMAND)?.[1] ?? "";
    const args = command.replace(COMMIT_PLACEHOLDER, sha).split(" ").slice(1);
    const run = await tenbox(args, worktree);
    partDones.push(run.json);
    const checks = { ok: true, commit: sha, file: "f", round: 1 };
    return { status: "done", proofs: [], partDone: run.json, checks };
  };
}

const cleanReply = { must_fix: [], nice_to_have: [], attention: [], unproven: [] };

test("a must_fix round: every part done the workflow gives a worker passes the real CLI", async () => {
  const partDones: Json[] = [];
  const worker = cliWorker(partDones);
  const agent: ScriptedAgent = async (prompt, options) => {
    if (options.agentType === "worker") return worker(prompt, options);
    if (options.agentType === "reviewer" && options.label === "round 1: base")
      return { ...cleanReply, must_fix: ["a.txt is wrong"] };
    if (options.agentType === "reviewer") return cleanReply;
    return { ok: true, file: "f" };
  };
  const parts = plan.parts.map((part) => ({ id: part.id, difficulty: part.difficulty }));
  const result = await runWorkflow({ task: "T-1", parts, lenses: [], maxRounds: 2 }, agent);
  expect(partDones.map((json) => [json.part, json.ok])).toEqual([
    ["01", true],
    ["02", true],
    ["fix", true],
  ]);
  expect(result.status).toBe("ready-for-you");
});
