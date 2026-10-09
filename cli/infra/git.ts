import path from "node:path";
import { gitFailedError } from "../../domain/errors/git.ts";
import type { TenboxError } from "../../domain/errors/index.ts";
import type { ChangedFile } from "../../domain/stats.ts";
import { lastNonEmpty, MS_PER_SECOND } from "../../domain/utils.ts";
import { files } from "./files.ts";
import { type ProcessResult, processes } from "./processes.ts";

interface AddWorktreeInput {
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
  findConfig,
  findBranchCreated,
  listChangedFiles,
  listGeneratedFiles,
  findCommonDir,
  findMainDir,
  findCommit,
  refExists,
  branchExists,
  addWorktree,
  removeWorktree,
  pruneWorktrees,
  deleteBranch,
  hasChanges,
  isMerged,
  push,
  pull,
  remoteBranchExists,
  deleteRemoteBranch,
  fetch,
  addDetachedWorktree,
  merge,
  ensureExcludes,
};

const GIT_LOCALE = "C";
const REFLOG_TIME = /@\{(\d+)\}$/;
const BINARY_COUNT = "-";
const GENERATED_ATTR = "linguist-generated";
const GENERATED_VALUES = ["set", "true"];
/** `check-attr -z` prints path, attribute and value, each ended by NUL. */
const ATTR_FIELDS = 3;
const NOT_A_REPOSITORY = "not a git repository";

/** Decides from a failed git result whether it is the expected "not found" answer. */
type IsNotFound = (result: ProcessResult) => boolean;

const exitedWithOne: IsNotFound = (result) => result.code === 1;
const outsideRepository: IsNotFound = (result) => result.stderr.includes(NOT_A_REPOSITORY);

/** English messages in any locale, so `outsideRepository` can match git's stderr. */
function runRaw(args: string[], cwd: string): Promise<ProcessResult> {
  return processes.run(["git", ...args], { cwd, env: { LC_ALL: GIT_LOCALE } });
}

function gitError(args: string[], result: ProcessResult): TenboxError {
  const reason = result.stderr.trim() || result.stdout.trim();
  return gitFailedError(args, reason);
}

/** Trimmed stdout; throws on a non-zero exit. */
async function run(args: string[], cwd: string): Promise<string> {
  const result = await runRaw(args, cwd);
  if (result.code !== 0) throw gitError(args, result);
  return result.stdout.trim();
}

/** Trimmed stdout, or null when `isNotFound` accepts the failure; any other failure throws. */
async function find(args: string[], cwd: string, isNotFound: IsNotFound): Promise<string | null> {
  const result = await runRaw(args, cwd);
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

/** The main checkout: the directory that holds the shared `.git`; null outside a repository. */
async function findMainDir(dir: string): Promise<string | null> {
  const common = await findCommonDir(dir);
  return common === null ? null : path.dirname(common);
}

/** Null when the key is not set. */
function findConfig(dir: string, key: string): Promise<string | null> {
  return find(["config", "--get", key], dir, exitedWithOne);
}

/** ISO time of the oldest reflog entry of the branch; null without a branch or a reflog. */
async function findBranchCreated(dir: string, branch: string): Promise<string | null> {
  const exists = await branchExists(dir, branch);
  if (!exists) return null;
  const log = await run(["log", "-g", "--date=unix", "--format=%gd", `refs/heads/${branch}`], dir);
  const oldest = lastNonEmpty(log.split("\n"));
  const seconds = oldest === undefined ? undefined : REFLOG_TIME.exec(oldest)?.[1];
  return seconds === undefined ? null : new Date(Number(seconds) * MS_PER_SECOND).toISOString();
}

/** What the branch changed since it left `base`, from `git diff --numstat base...branch`. */
async function listChangedFiles(dir: string, base: string, branch: string): Promise<ChangedFile[]> {
  const numstat = await run(["diff", "--numstat", `${base}...${branch}`], dir);
  const lines = numstat.split("\n").filter((line) => line !== "");
  return lines.map(parseNumstatLine);
}

/** The paths whose `linguist-generated` attribute is set; `dir` decides which `.gitattributes` apply. */
async function listGeneratedFiles(dir: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const out = await run(["check-attr", "-z", GENERATED_ATTR, "--", ...paths], dir);
  const fields = out.split("\0");
  const generated: string[] = [];
  for (let i = 0; i + 2 < fields.length; i += ATTR_FIELDS) {
    if (GENERATED_VALUES.includes(fields[i + 2] ?? "")) generated.push(fields[i] ?? "");
  }
  return generated;
}

/** `added<TAB>removed<TAB>path`; a binary file shows `-` for both counts. */
function parseNumstatLine(line: string): ChangedFile {
  const [added = "", removed = "", ...rest] = line.split("\t");
  return { added: lineCount(added), removed: lineCount(removed), path: rest.join("\t") };
}

const lineCount = (count: string): number => (count === BINARY_COUNT ? 0 : Number(count));

/** The sha of `ref`, or null when it does not exist. */
function findCommit(dir: string, ref: string): Promise<string | null> {
  return find(["rev-parse", "--verify", "--quiet", ref], dir, exitedWithOne);
}

async function refExists(dir: string, ref: string): Promise<boolean> {
  const sha = await findCommit(dir, ref);
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

/** Forgets worktrees whose folder is gone, so their branches can be deleted. */
async function pruneWorktrees(mainDir: string): Promise<void> {
  await run(["worktree", "prune"], mainDir);
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

/** Pushes the branch to `origin` and sets it as the upstream. A rejected push throws. */
async function push(dir: string, branch: string): Promise<void> {
  await run(["push", "-u", "origin", branch], dir);
}

/** Moves the checked-out `base` of `dir` to `origin/<base>`; throws unless it is a fast-forward. */
async function pull(dir: string, base: string): Promise<void> {
  await run(["pull", "--quiet", "--ff-only", "origin", base], dir);
}

async function remoteBranchExists(dir: string, branch: string): Promise<boolean> {
  const out = await run(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], dir);
  return out !== "";
}

async function deleteRemoteBranch(dir: string, branch: string): Promise<void> {
  await run(["push", "origin", "--delete", branch], dir);
}

/** Updates the remote-tracking branches of `origin`; nothing local moves. */
async function fetch(dir: string): Promise<void> {
  await run(["fetch", "--quiet", "origin"], dir);
}

/** A worktree with no branch, checked out at `ref`. */
async function addDetachedWorktree(mainDir: string, worktree: string, ref: string): Promise<void> {
  await run(["worktree", "add", "--detach", worktree, ref], mainDir);
}

/** A merge commit needs an author; the user's own git config is not required. */
const MERGE_IDENTITY = ["-c", "user.name=Tenbox", "-c", "user.email=tenbox@localhost"];

/** Merges `ref` into HEAD. Returns the conflicted files, empty after a clean merge. */
async function merge(dir: string, ref: string): Promise<string[]> {
  const args = [...MERGE_IDENTITY, "merge", "--no-edit", ref];
  const result = await runRaw(args, dir);
  if (result.code === 0) return [];
  const out = await run(["diff", "--name-only", "--diff-filter=U"], dir);
  if (out === "") throw gitError(args, result);
  return out.split("\n");
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
