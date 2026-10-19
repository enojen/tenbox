import path from "node:path";
import { isPlainObject, parseObject } from "../../../domain/utils.ts";
import { env } from "../env.ts";
import { files } from "../files.ts";

/** The claude.ai login file of Claude Code (not a public API). Only the expiry is read. */
export const claudeCredentials = { file, findRefreshExpiry };

function file(): string {
  return path.join(env().claudeDir, ".credentials.json");
}

/** When the refresh token ends, in epoch ms; null without the file or the field. Never a token. */
async function findRefreshExpiry(): Promise<number | null> {
  const content = await files.read(file());
  if (content === null) return null;
  const oauth = parseObject(content)?.claudeAiOauth;
  if (!isPlainObject(oauth)) return null;
  const expiry = oauth.refreshTokenExpiresAt;
  return typeof expiry === "number" ? expiry : null;
}
