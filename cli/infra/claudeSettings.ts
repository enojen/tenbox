import path from "node:path";
import { isPlainObject } from "../domain/utils.ts";
import { files } from "./files.ts";

/** Claude Code's local settings in a checkout: `.claude/settings.local.json`. */
export const claudeSettings = { ensureHeadBaseRef };

/**
 * Subagent worktrees branch from HEAD, which inside the task worktree is feat/<id>.
 * Claude Code reads local settings from the main checkout, so the file lives there.
 */
async function ensureHeadBaseRef(mainDir: string): Promise<void> {
  const file = path.join(mainDir, ".claude", "settings.local.json");
  const settings = await read(file);
  const worktree = isPlainObject(settings.worktree) ? settings.worktree : {};
  if (worktree.baseRef === "head") return;
  const updated = { ...settings, worktree: { ...worktree, baseRef: "head" } };
  await files.write(file, `${JSON.stringify(updated, null, 2)}\n`);
}

async function read(file: string): Promise<Record<string, unknown>> {
  const text = await files.read(file);
  const parsed: unknown = text === null ? {} : JSON.parse(text);
  return isPlainObject(parsed) ? parsed : {};
}
