import path from "node:path";
import { noRepoError } from "../../domain/errors/git.ts";
import { env, log } from "../infra/env.ts";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";
import type { InstallResult, LinkEntry, LinkState, LinkTarget } from "./results.ts";

/** What `tenbox install` found or did for one link. */
export const LINK_STATE = { linked: "linked", unchanged: "unchanged", skipped: "skipped" } as const;

/** The checkout directories that `~/.claude/` gets a copy of, as symlinks. */
const LINKED_DIRS: string[] = ["agents", "workflows"];

interface DirPair {
  sourceDir: string;
  linkDir: string;
}

/**
 * Symlink every file of `agents/` and `workflows/` into `claudeDir`. Never overwrites, never
 * deletes. The sources come from the main checkout of `tenboxRoot`, so a task worktree can run it.
 */
export async function install(tenboxRoot: string = env().tenboxRoot): Promise<InstallResult> {
  const { claudeDir } = env();
  // The main checkout outlives its task worktrees, so the links do too.
  const sourceRoot = await git.findMainDir(tenboxRoot);
  if (sourceRoot === null) {
    throw noRepoError(tenboxRoot);
  }
  const links: LinkEntry[] = [];
  for (const dir of LINKED_DIRS) {
    const entries = await installDir(sourceRoot, dir);
    links.push(...entries);
  }
  for (const entry of links) log(`tenbox install: ${entry.state} ${entry.link}`);
  const ok = links.every((entry) => entry.state !== LINK_STATE.skipped);
  return { ok, claude_dir: claudeDir, links };
}

async function installDir(sourceRoot: string, dir: string): Promise<LinkEntry[]> {
  const { claudeDir } = env();
  const pair = { sourceDir: path.join(sourceRoot, dir), linkDir: path.join(claudeDir, dir) };
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
async function ensureLink(target: LinkTarget): Promise<LinkState> {
  const { source, link } = target;
  const current = await files.readLink(link);
  if (current === source) return LINK_STATE.unchanged;
  // `exists` follows symlinks, so a dangling foreign link needs the `readLink` test too.
  if (current !== null) return LINK_STATE.skipped;
  const occupied = await files.exists(link);
  if (occupied) return LINK_STATE.skipped;
  await files.symlink(source, link);
  return LINK_STATE.linked;
}
