import { z } from "zod";
import { TenboxError } from "../../domain/errors/index.ts";
import { ghError } from "../../domain/errors/tools.ts";
import { bodyHasLine, type CiCheck, parseCiChecks } from "../../domain/prs.ts";
import { jsons } from "../../domain/utils.ts";
import { processes } from "./processes.ts";

export interface PrText {
  title: string;
  body: string;
}

interface CreatePrInput extends PrText {
  branch: string;
  base: string;
  draft: boolean;
}

export const GH_STATE = { open: "OPEN", closed: "CLOSED", merged: "MERGED" } as const;

export type GhPrState = (typeof GH_STATE)[keyof typeof GH_STATE];

export interface GroupPr {
  number: number;
  url: string;
  draft: boolean;
  state: GhPrState;
  /** The head branch of the PR, as GitHub names it. */
  branch: string;
}

/** The GitHub CLI commands Tenbox uses, run in the task worktree. */
export const gh = {
  findPr,
  isMergedAt,
  countParents,
  findByLine,
  findByBranch,
  listOpen,
  create,
  edit,
  markReady,
  listChecks,
};

const PR_FIELDS = "number,url,isDraft,state,body,headRefName";

/** The output of `gh pr list --json number,url,isDraft,state,body,headRefName`. */
const PrListSchema = z.array(
  z.object({
    number: z.number(),
    url: z.string(),
    isDraft: z.boolean(),
    state: z.enum(GH_STATE),
    body: z.string(),
    headRefName: z.string(),
  }),
);

type ListedPr = z.infer<typeof PrListSchema>[number];

const toGroupPr = (pr: ListedPr): GroupPr => ({
  number: pr.number,
  url: pr.url,
  draft: pr.isDraft,
  state: pr.state,
  branch: pr.headRefName,
});

/** The open PR first: a closed PR with the same line or branch is old. */
const pickPr = (prs: ListedPr[]): ListedPr | undefined =>
  prs.find((pr) => pr.state === GH_STATE.open) ?? prs[0];

/** The output of `gh pr list --json number,headRefName`. */
const PrBranchListSchema = z.array(z.object({ number: z.number(), headRefName: z.string() }));

export interface PrBranch {
  number: number;
  branch: string;
}

/** `gh pr list` shows 30 by default. */
const LIST_LIMIT = "100";

/** The output of `gh pr view --json state,headRefOid,mergeCommit,createdAt,mergedAt`. */
const PrViewSchema = z.object({
  state: z.enum(GH_STATE),
  headRefOid: z.string(),
  mergeCommit: z.object({ oid: z.string() }).nullish(),
  createdAt: z.iso.datetime(),
  mergedAt: z.iso.datetime().nullish(),
});
type PrState = z.infer<typeof PrViewSchema>;

/** Merged at exactly this head: a commit after the PR head is not on GitHub. */
function isMergedAt(pr: PrState, head: string): boolean {
  return pr.state === GH_STATE.merged && pr.headRefOid === head;
}

/** `pr create`, `api --method`: enough to name the command in an error without its long arguments. */
const SUBCOMMAND_WORDS = 2;

interface GhOutput<T> {
  schema: z.ZodType<T>;
  /** The `gh` words for the error, such as `pr list`. */
  subcommand: string;
  stdout: string;
}

/** The `--json` output of a `gh` command; a `gh` error with the issues when it does not fit. */
function checkOutput<T>(output: GhOutput<T>): T {
  const result = jsons.check(output.schema, output.stdout);
  if (result.ok) return result.value;
  throw ghError(output.subcommand, `output does not fit: ${result.issues.join("; ")}`);
}

async function run(args: string[], cwd: string): Promise<string> {
  const result = await processes.run(["gh", ...args], { cwd });
  if (result.code === 0) return result.stdout.trim();
  const reason = result.stderr.trim() || result.stdout.trim();
  throw ghError(args.slice(0, SUBCOMMAND_WORDS).join(" "), reason);
}

/** The PR of the branch, or null when there is none or `gh` cannot answer (missing, no login). */
async function findPr(dir: string, branch: string): Promise<PrState | null> {
  const args = ["pr", "view", branch, "--json", "state,headRefOid,mergeCommit,createdAt,mergedAt"];
  try {
    const result = await processes.run(["gh", ...args], { cwd: dir });
    if (result.code !== 0) return null;
    return checkOutput({ schema: PrViewSchema, subcommand: "pr view", stdout: result.stdout });
  } catch (e) {
    if (e instanceof TenboxError && e.code === "no-command") return null;
    throw e;
  }
}

/** How many parents the commit has: one for a squash or rebase merge, two for a merge commit. */
async function countParents(dir: string, sha: string): Promise<number> {
  const endpoint = `repos/{owner}/{repo}/commits/${sha}`;
  const out = await run(["api", endpoint, "--jq", ".parents | length"], dir);
  const parents = Number(out);
  if (!Number.isInteger(parents)) throw ghError("api", `not a parent count: ${out}`);
  return parents;
}

/** GitHub search finds the body text; the exact line match is ours. */
async function findByLine(dir: string, line: string): Promise<GroupPr | null> {
  const args = ["pr", "list", "--state", "all", "--search", `"${line}" in:body`];
  const out = await run([...args, "--limit", LIST_LIMIT, "--json", PR_FIELDS], dir);
  const listed = checkOutput({ schema: PrListSchema, subcommand: "pr list", stdout: out });
  const found = listed.filter((pr) => bodyHasLine(pr.body, line));
  const pr = pickPr(found);
  return pr === undefined ? null : toGroupPr(pr);
}

async function findByBranch(dir: string, branch: string): Promise<GroupPr | null> {
  const args = ["pr", "list", "--head", branch, "--state", "all", "--json", PR_FIELDS];
  const out = await run(args, dir);
  const pr = pickPr(checkOutput({ schema: PrListSchema, subcommand: "pr list", stdout: out }));
  return pr === undefined ? null : toGroupPr(pr);
}

/** Every open PR into `base`. */
async function listOpen(dir: string, base: string): Promise<PrBranch[]> {
  const args = ["pr", "list", "--state", "open", "--base", base, "--limit", LIST_LIMIT];
  const out = await run([...args, "--json", "number,headRefName"], dir);
  const listed = checkOutput({ schema: PrBranchListSchema, subcommand: "pr list", stdout: out });
  return listed.map((pr) => ({
    number: pr.number,
    branch: pr.headRefName,
  }));
}

async function create(dir: string, input: CreatePrInput): Promise<void> {
  const { branch, base, title, body } = input;
  const args = ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body];
  await run(input.draft ? [...args, "--draft"] : args, dir);
}

/** Through the REST API: `gh pr edit` in gh 2.45 queries the removed classic Projects and fails. */
async function edit(dir: string, number: number, text: PrText): Promise<void> {
  const endpoint = `repos/{owner}/{repo}/pulls/${number}`;
  const fields = ["-f", `title=${text.title}`, "-f", `body=${text.body}`];
  await run(["api", "--method", "PATCH", endpoint, ...fields], dir);
}

async function markReady(dir: string, number: number): Promise<void> {
  await run(["pr", "ready", String(number)], dir);
}

const NO_CHECKS = "no checks reported";

/**
 * The CI checks of a PR. gh exits 1 when a check failed and 8 while one is pending: both come
 * with the lines on stdout, so only an empty stdout is an error.
 */
async function listChecks(dir: string, number: number): Promise<CiCheck[]> {
  const result = await processes.run(["gh", "pr", "checks", String(number)], { cwd: dir });
  if (result.stdout.trim() !== "") return parseCiChecks(result.stdout);
  if (result.code === 0 || result.stderr.includes(NO_CHECKS)) return [];
  throw ghError("pr checks", result.stderr.trim());
}
