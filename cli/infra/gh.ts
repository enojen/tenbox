import { z } from "zod";
import { TenboxError } from "../domain/errors.ts";
import { spawn } from "./spawn.ts";

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

async function run(args: string[], cwd: string): Promise<string> {
  const result = await spawn(["gh", ...args], { cwd });
  if (result.code === 0) return result.stdout.trim();
  const reason = result.stderr.trim() || result.stdout.trim();
  throw new TenboxError(`gh ${args.join(" ")} failed: ${reason}`, "gh");
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

async function edit(dir: string, number: number, text: PrText): Promise<void> {
  await run(["pr", "edit", String(number), "--title", text.title, "--body", text.body], dir);
}

async function markReady(dir: string, number: number): Promise<void> {
  await run(["pr", "ready", String(number)], dir);
}
