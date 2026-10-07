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
    const targetDir = path.join(env.claudeDir, dir);
    await files.mkdir(targetDir);
    for (const name of (await files.list(sourceDir)).filter(isLinkable).sort()) {
      links.push(await link(files, name, path.join(sourceDir, name), path.join(targetDir, name)));
    }
  }
  for (const l of links) log(`tenbox install: ${l.state} ${l.target}`);
  return { ok: links.every((l) => l.state !== "skipped"), claude_dir: env.claudeDir, links };
}

/** Dotfiles like `.gitkeep` are repo plumbing, not roles or workflows. */
const isLinkable = (name: string) => !name.startsWith(".");

async function link(files: Ports["files"], name: string, source: string, target: string): Promise<Link> {
  const current = await files.readLink(target);
  if (current === source) return { name, source, target, state: "unchanged" };
  // `exists` follows symlinks, so a dangling foreign link needs the `readLink` test too.
  if (current !== null || (await files.exists(target))) return { name, source, target, state: "skipped" };
  await files.symlink(source, target);
  return { name, source, target, state: "linked" };
}
