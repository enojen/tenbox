import path from "node:path";
import { parseObject } from "../../../domain/utils.ts";
import { env } from "../env.ts";
import { files } from "../files.ts";

/** Where a Claude Code session of claude.ai/code opens. */
const SESSION_URL = "https://claude.ai/code/";
const SESSION_FILE = /\.json$/;

/** `<claudeDir>/sessions/<pid>.json`: the session link of a worktree (not a public API). */
export const sessionLinks = { find };

interface LinkedSession {
  startedAt: number;
  bridgeSessionId: string;
}

/** The link of the newest session started in `cwd`; null without one. Read at each call. */
async function find(cwd: string): Promise<string | null> {
  const real = await files.realPath(cwd);
  const dir = path.join(env().claudeDir, "sessions");
  const names = await files.list(dir);
  let newest: LinkedSession | null = null;
  for (const name of names.filter((n) => SESSION_FILE.test(n))) {
    const session = await readSession({ file: path.join(dir, name), cwd: real });
    if (session !== null && (newest === null || session.startedAt > newest.startedAt)) {
      newest = session;
    }
  }
  return newest === null ? null : `${SESSION_URL}${newest.bridgeSessionId}`;
}

interface SessionRead {
  file: string;
  cwd: string;
}

/** Null when the file is another cwd's or has no `bridgeSessionId`. */
async function readSession(input: SessionRead): Promise<LinkedSession | null> {
  const content = await files.read(input.file);
  const json = content === null ? null : parseObject(content);
  if (json === null || json.cwd !== input.cwd) return null;
  const { bridgeSessionId, startedAt } = json;
  if (typeof bridgeSessionId !== "string" || bridgeSessionId === "") return null;
  return { bridgeSessionId, startedAt: typeof startedAt === "number" ? startedAt : 0 };
}
