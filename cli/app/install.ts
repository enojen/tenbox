import path from "node:path";
import type { Ports } from "../ports.ts";
import type { InstallResult, Link } from "./results.ts";

/** The checkout directories that `~/.claude/` gets a copy of, as symlinks. */
const LINKED_DIRS = ["agents", "workflows"] as const;

/** Symlink every file of `agents/` and `workflows/` into `claudeDir`. Never overwrites, never deletes. */
export async function install(ports: Ports): Promise<InstallResult> {
  const { files, env, log } = ports;
  const links: Link[] = [];
  for (const dir of LINKED_DIRS) {
    const sourceDir = path.join(env.tenboxRoot, dir);
    const linkDir = path.join(env.claudeDir, dir);
    await files.mkdir(linkDir);
    for (const name of (await files.list(sourceDir)).filter(isLinkable).sort()) {
      links.push(await link(files, { name, source: path.join(sourceDir, name), link: path.join(linkDir, name) }));
    }
  }
  for (const l of links) log(`tenbox install: ${l.state} ${l.link}`);
  return { ok: links.every((l) => l.state !== "skipped"), claude_dir: env.claudeDir, links };
}

/** Dotfiles like `.gitkeep` are repo plumbing, not roles or workflows. */
const isLinkable = (name: string) => !name.startsWith(".");

async function link(files: Ports["files"], entry: Omit<Link, "state">): Promise<Link> {
  return { ...entry, state: await linkState(files, entry) };
}

async function linkState(files: Ports["files"], { source, link }: Omit<Link, "state">): Promise<Link["state"]> {
  const current = await files.readLink(link);
  if (current === source) return "unchanged";
  // `exists` follows symlinks, so a dangling foreign link needs the `readLink` test too.
  if (current !== null || (await files.exists(link))) return "skipped";
  await files.symlink(source, link);
  return "linked";
}
