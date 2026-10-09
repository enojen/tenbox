import { z } from "zod";
import { TenboxError } from "../../domain/errors/index.ts";
import { ghError } from "../../domain/errors/tools.ts";
import { parseJson } from "../../domain/utils.ts";
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

export interface OpenPr {
  number: number;
  url: string;
  draft: boolean;
}

/** The GitHub CLI commands Tenbox uses, run in the task worktree. */
export const gh = { findPr, isMergedAt, findOpen, listOpen, create, edit, markReady };

/** The output of `gh pr list --json number,url,isDraft`. */
const PrListSchema = z.array(
  z.object({ number: z.number(), url: z.string(), isDraft: z.boolean() }),
);

/** The output of `gh pr list --json number,headRefName`. */
const PrBranchListSchema = z.array(z.object({ number: z.number(), headRefName: z.string() }));

export interface PrBranch {
  number: number;
  branch: string;
}

/** `gh pr list` shows 30 by default. */
const LIST_LIMIT = "100";

/** The output of `gh pr view --json state,headRefOid`. */
const PrViewSchema = z.object({
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  headRefOid: z.string(),
});
type PrState = z.infer<typeof PrViewSchema>;
const MERGED = "MERGED";

/** Merged at exactly this head: a commit after the PR head is not on GitHub. */
function isMergedAt(pr: PrState, head: string): boolean {
  return pr.state === MERGED && pr.headRefOid === head;
}

/** `pr create`, `api --method`: enough to name the command in an error without its long arguments. */
const SUBCOMMAND_WORDS = 2;

async function run(args: string[], cwd: string): Promise<string> {
  const result = await processes.run(["gh", ...args], { cwd });
  if (result.code === 0) return result.stdout.trim();
  const reason = result.stderr.trim() || result.stdout.trim();
  throw ghError(args.slice(0, SUBCOMMAND_WORDS).join(" "), reason);
}

/** The PR of the branch, or null when there is none or `gh` cannot answer (missing, no login). */
async function findPr(dir: string, branch: string): Promise<PrState | null> {
  const args = ["pr", "view", branch, "--json", "state,headRefOid"];
  try {
    const result = await processes.run(["gh", ...args], { cwd: dir });
    if (result.code !== 0) return null;
    return PrViewSchema.parse(parseJson(result.stdout));
  } catch (e) {
    if (e instanceof TenboxError && e.code === "no-command") return null;
    throw e;
  }
}

/** The open PR of the branch, or null. */
async function findOpen(dir: string, branch: string): Promise<OpenPr | null> {
  const args = ["pr", "list", "--head", branch, "--state", "open", "--json", "number,url,isDraft"];
  const out = await run(args, dir);
  const first = PrListSchema.parse(parseJson(out))[0];
  if (first === undefined) return null;
  return { number: first.number, url: first.url, draft: first.isDraft };
}

/** Every open PR into `base`. */
async function listOpen(dir: string, base: string): Promise<PrBranch[]> {
  const args = ["pr", "list", "--state", "open", "--base", base, "--limit", LIST_LIMIT];
  const out = await run([...args, "--json", "number,headRefName"], dir);
  return PrBranchListSchema.parse(parseJson(out)).map((pr) => ({
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
