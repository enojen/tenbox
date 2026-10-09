import { z } from "zod";
import { TenboxError } from "../../domain/errors/index.ts";
import { processes } from "./processes.ts";

export interface PrText {
  title: string;
  body: string;
}

export interface CreatePrInput extends PrText {
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
export const gh = { findOpen, create, edit, markReady };

/** The output of `gh pr list --json number,url,isDraft`. */
const PrListSchema = z.array(
  z.object({ number: z.number(), url: z.string(), isDraft: z.boolean() }),
);

/** `pr create`, `api --method`: enough to name the command in an error without its long arguments. */
const SUBCOMMAND_WORDS = 2;

async function run(args: string[], cwd: string): Promise<string> {
  const result = await processes.run(["gh", ...args], { cwd });
  if (result.code === 0) return result.stdout.trim();
  const reason = result.stderr.trim() || result.stdout.trim();
  throw new TenboxError(`gh ${args.slice(0, SUBCOMMAND_WORDS).join(" ")} failed: ${reason}`, "gh");
}

/** The open PR of the branch, or null. */
async function findOpen(dir: string, branch: string): Promise<OpenPr | null> {
  const args = ["pr", "list", "--head", branch, "--state", "open", "--json", "number,url,isDraft"];
  const out = await run(args, dir);
  const first = PrListSchema.parse(JSON.parse(out))[0];
  if (first === undefined) return null;
  return { number: first.number, url: first.url, draft: first.isDraft };
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
