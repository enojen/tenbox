import path from "node:path";
import { env, log } from "../../infra/env.ts";
import { files } from "../../infra/files.ts";
import type { InstallResult, LinkEntry, LinkState, LinkTarget } from "./results.ts";

/** The checkout directories that `~/.claude/` gets a copy of, as symlinks. */
const LINKED_DIRS = ["agents", "workflows"] as const;

interface DirPair {
  sourceDir: string;
  linkDir: string;
}

/** Symlink every file of `agents/` and `workflows/` into `claudeDir`. Never overwrites, never deletes. */
export async function install(): Promise<InstallResult> {
  const { claudeDir } = env();
  const links: LinkEntry[] = [];
  for (const dir of LINKED_DIRS) {
    const entries = await installDir(dir);
    links.push(...entries);
  }
  for (const entry of links) log(`tenbox install: ${entry.state} ${entry.link}`);
  const ok = links.every((entry) => entry.state !== "skipped");
  return { ok, claude_dir: claudeDir, links };
}

async function installDir(dir: string): Promise<LinkEntry[]> {
  const { tenboxRoot, claudeDir } = env();
  const pair = { sourceDir: path.join(tenboxRoot, dir), linkDir: path.join(claudeDir, dir) };
  await files.mkdir(pair.linkDir);
  const all = await files.list(pair.sourceDir);
  const names = all.filter(isLinkable).sort();
  const entries: LinkEntry[] = [];
  for (const name of names) {
    const target = linkTarget(pair, name);
    const state = await ensureLink(target);
    entries.push({ ...target, state });
  }
  return entries;
}

/** Dotfiles like `.gitkeep` are repo plumbing, not roles or workflows. */
function isLinkable(name: string): boolean {
  return !name.startsWith(".");
}

function linkTarget(pair: DirPair, name: string): LinkTarget {
  return { name, source: path.join(pair.sourceDir, name), link: path.join(pair.linkDir, name) };
}

/** Creates the link when nothing is in its place; reports what it found or did. */
async function ensureLink({ source, link }: LinkTarget): Promise<LinkState> {
  const current = await files.readLink(link);
  if (current === source) return "unchanged";
  // `exists` follows symlinks, so a dangling foreign link needs the `readLink` test too.
  if (current !== null) return "skipped";
  const occupied = await files.exists(link);
  if (occupied) return "skipped";
  await files.symlink(source, link);
  return "linked";
}
