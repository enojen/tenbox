import path from "node:path";
import { settingsError } from "../../../domain/errors/tools.ts";
import { jsons, objects } from "../../../domain/utils.ts";
import { files } from "../files.ts";

/** Claude Code's local settings in a checkout: `.claude/settings.local.json`. */
export const claudeSettings = { ensureHeadBaseRef };

/**
 * Subagent worktrees branch from HEAD, which inside the task worktree is feat/<id>.
 * Claude Code reads local settings from the main checkout, so the file lives there.
 */
async function ensureHeadBaseRef(mainDir: string): Promise<void> {
  const file = path.join(mainDir, ".claude", "settings.local.json");
  const settings = await read(file);
  const worktree = objects.isRecord(settings.worktree) ? settings.worktree : {};
  if (worktree.baseRef === "head") return;
  const updated = { ...settings, worktree: { ...worktree, baseRef: "head" } };
  await files.writeJson(file, updated);
}

async function read(file: string): Promise<Record<string, unknown>> {
  const text = await files.read(file);
  if (text === null) return {};
  const parsed = jsons.parse(text);
  if (parsed === undefined) throw settingsError(file, "is not valid JSON");
  return objects.isRecord(parsed) ? parsed : {};
}
