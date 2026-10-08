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
  addWorktree,
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
