import path from "node:path";
import { TenboxError } from "../domain/errors.ts";
import { files } from "./files.ts";
import { type Spawned, spawn } from "./spawn.ts";

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
  branchExists,
  addWorktree,
  removeWorktree,
  deleteBranch,
  hasChanges,
  isMerged,
  ensureExcludes,
};

const GIT_LOCALE = "C";
const NOT_A_REPOSITORY = "not a git repository";

/** Decides from a failed git result whether it is the expected "not found" answer. */
type IsNotFound = (result: Spawned) => boolean;

const exitedWithOne: IsNotFound = (result) => result.code === 1;
const outsideRepository: IsNotFound = (result) => result.stderr.includes(NOT_A_REPOSITORY);

/** English messages in any locale, so `outsideRepository` can match git's stderr. */
function spawnGit(args: string[], cwd: string): Promise<Spawned> {
  return spawn(["git", ...args], { cwd, env: { LC_ALL: GIT_LOCALE } });
}

function gitError(args: string[], result: Spawned): TenboxError {
  const reason = result.stderr.trim() || result.stdout.trim();
  return new TenboxError(`git ${args.join(" ")} failed: ${reason}`, "git");
}

/** Trimmed stdout; throws on a non-zero exit. */
async function run(args: string[], cwd: string): Promise<string> {
  const result = await spawnGit(args, cwd);
  if (result.code !== 0) throw gitError(args, result);
  return result.stdout.trim();
}

/** Trimmed stdout, or null when `isNotFound` accepts the failure; any other failure throws. */
async function find(args: string[], cwd: string, isNotFound: IsNotFound): Promise<string | null> {
  const result = await spawnGit(args, cwd);
  if (result.code === 0) return result.stdout.trim();
  if (isNotFound(result)) return null;
  throw gitError(args, result);
}

function findHead(dir: string): Promise<string | null> {
  return find(["rev-parse", "--verify", "--quiet", "HEAD"], dir, exitedWithOne);
}

/** Null when HEAD and `ref` have no common ancestor. */
function findMergeBase(dir: string, ref: string): Promise<string | null> {
  return find(["merge-base", "HEAD", ref], dir, exitedWithOne);
}

/** The root of the checkout that contains `dir`. */
function findTopLevel(dir: string): Promise<string | null> {
  return find(["rev-parse", "--show-toplevel"], dir, outsideRepository);
}

/** Null on a detached HEAD. */
function findBranch(dir: string): Promise<string | null> {
  return find(["symbolic-ref", "--quiet", "--short", "HEAD"], dir, exitedWithOne);
}

/** The `.git` directory every worktree of the repository shares, as an absolute path. */
async function findCommonDir(dir: string): Promise<string | null> {
  const common = await find(["rev-parse", "--git-common-dir"], dir, outsideRepository);
  return common === null ? null : path.resolve(dir, common);
}

async function refExists(dir: string, ref: string): Promise<boolean> {
  const sha = await find(["rev-parse", "--verify", "--quiet", ref], dir, exitedWithOne);
  return sha !== null;
}

function branchExists(dir: string, branch: string): Promise<boolean> {
  return refExists(dir, `refs/heads/${branch}`);
}

async function addWorktree(input: AddWorktreeInput): Promise<void> {
  const { mainDir, branch, base } = input;
  const exists = await branchExists(mainDir, branch);
  const args = exists ? [input.path, branch] : ["-b", branch, input.path, base];
  await run(["worktree", "add", ...args], mainDir);
}

/** Removes the worktree with whatever is in it; the caller checked for changes first. */
async function removeWorktree(mainDir: string, worktree: string): Promise<void> {
  await run(["worktree", "remove", "--force", worktree], mainDir);
}

/** Deletes the branch even when it is not merged; the caller checked that first. */
async function deleteBranch(mainDir: string, branch: string): Promise<void> {
  await run(["branch", "-D", branch], mainDir);
}

/** Modified, staged and untracked files count; paths in `info/exclude` do not. */
async function hasChanges(dir: string): Promise<boolean> {
  const status = await run(["status", "--porcelain"], dir);
  return status !== "";
}

/** True when merging `branch` into `base` would change nothing, e.g. after a squash merge. */
async function isMerged(dir: string, base: string, branch: string): Promise<boolean> {
  const mergedTree = await find(["merge-tree", "--write-tree", base, branch], dir, exitedWithOne);
  if (mergedTree === null) return false;
  const baseTree = await run(["rev-parse", `${base}^{tree}`], dir);
  return mergedTree.split("\n")[0] === baseTree;
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
