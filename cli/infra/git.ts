import path from "node:path";
import { TenboxError } from "../domain/errors.ts";
import { files } from "./files.ts";
import { spawn } from "./spawn.ts";

export interface AddWorktreeInput {
  mainDir: string;
  path: string;
  branch: string;
  /** Where a new branch starts; an existing branch is checked out as it is. */
  base: string;
}

/** The git commands Tenbox uses, by name; `run` is for tests that build a repository. */
export const git = {
  run,
  findHead,
  findMergeBase,
  findTopLevel,
  findBranch,
  findCommonDir,
  refExists,
  addWorktree,
  ensureExcludes,
};

/** Trimmed stdout; throws on a non-zero exit. */
async function run(args: string[], cwd: string): Promise<string> {
  const result = await spawn(["git", ...args], { cwd });
  if (result.code !== 0) {
    const reason = result.stderr.trim() || result.stdout.trim();
    throw new TenboxError(`git ${args.join(" ")} failed: ${reason}`, "git");
  }
  return result.stdout.trim();
}

/** Trimmed stdout, or null on a non-zero exit. */
async function find(args: string[], cwd: string): Promise<string | null> {
  const result = await spawn(["git", ...args], { cwd });
  return result.code === 0 ? result.stdout.trim() : null;
}

function findHead(dir: string): Promise<string | null> {
  return find(["rev-parse", "HEAD"], dir);
}

function findMergeBase(dir: string, ref: string): Promise<string | null> {
  return find(["merge-base", "HEAD", ref], dir);
}

/** The root of the checkout that contains `dir`. */
function findTopLevel(dir: string): Promise<string | null> {
  return find(["rev-parse", "--show-toplevel"], dir);
}

function findBranch(dir: string): Promise<string | null> {
  return find(["rev-parse", "--abbrev-ref", "HEAD"], dir);
}

/** The `.git` directory every worktree of the repository shares, as an absolute path. */
async function findCommonDir(dir: string): Promise<string | null> {
  const common = await find(["rev-parse", "--git-common-dir"], dir);
  return common === null ? null : path.resolve(dir, common);
}

async function refExists(dir: string, ref: string): Promise<boolean> {
  const sha = await find(["rev-parse", "--verify", "--quiet", ref], dir);
  return sha !== null;
}

async function addWorktree(input: AddWorktreeInput): Promise<void> {
  const { mainDir, branch, base } = input;
  const branchExists = await refExists(mainDir, `refs/heads/${branch}`);
  const args = branchExists ? [input.path, branch] : ["-b", branch, input.path, base];
  await run(["worktree", "add", ...args], mainDir);
}

/** Adds the missing patterns to `<commonDir>/info/exclude`; returns the ones added. */
async function ensureExcludes(commonDir: string, patterns: readonly string[]): Promise<string[]> {
  const file = path.join(commonDir, "info", "exclude");
  const text = await files.read(file);
  const current = text ?? "";
  const added = patterns.filter((p) => !current.split("\n").includes(p));
  if (added.length === 0) return added;
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await files.write(file, `${current}${separator}${added.join("\n")}\n`);
  return added;
}
