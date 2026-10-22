import path from "node:path";
import { z } from "zod";
import { env } from "../env.ts";
import { claudeFiles } from "./claudeFiles.ts";

/** The claude.ai login file of Claude Code (not a public API). Only the expiry is read. */
export const claudeCredentials = { file, findRefreshExpiry };

/** No `claudeAiOauth` is no claude.ai login, not a broken file. Never a token. */
const CredentialsSchema = z.object({
  claudeAiOauth: z.object({ refreshTokenExpiresAt: z.number() }).optional(),
});

function file(): string {
  return path.join(env().claudeDir, ".credentials.json");
}

/** When the refresh token ends, in epoch ms; null without the file or the login. */
async function findRefreshExpiry(): Promise<number | null> {
  const credentials = await claudeFiles.find(CredentialsSchema, file());
  return credentials?.claudeAiOauth?.refreshTokenExpiresAt ?? null;
}
