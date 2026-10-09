import { lstat, mkdir, readdir, readlink, realpath, rename, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { hasErrorCode } from "../../domain/utils.ts";

const JSON_INDENT = 2;
const MISSING_CODES = ["ENOENT", "ENOTDIR"];

function isMissing(e: unknown): boolean {
  return hasErrorCode(e, MISSING_CODES);
}

export const files = {
  async exists(p: string): Promise<boolean> {
    try {
      await stat(p);
      return true;
    } catch (e) {
      if (isMissing(e)) return false;
      throw e;
    }
  },

  async isDir(p: string): Promise<boolean> {
    try {
      const info = await stat(p);
      return info.isDirectory();
    } catch (e) {
      if (isMissing(e)) return false;
      throw e;
    }
  },

  async read(p: string): Promise<string | null> {
    const file = Bun.file(p);
    const exists = await file.exists();
    return exists ? file.text() : null;
  },

  async write(p: string, text: string): Promise<void> {
    await mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    await Bun.write(tmp, text);
    await rename(tmp, p);
  },

  /** Two-space JSON and a newline, written like `write`. */
  async writeJson(p: string, value: unknown): Promise<void> {
    await files.write(p, `${JSON.stringify(value, null, JSON_INDENT)}\n`);
  },

  async mkdir(p: string): Promise<void> {
    await mkdir(p, { recursive: true });
  },

  async list(p: string): Promise<string[]> {
    try {
      return await readdir(p);
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
  },

  async mtime(p: string): Promise<number> {
    const info = await stat(p);
    return info.mtimeMs;
  },

  /** The path with every symlink resolved. */
  async realPath(p: string): Promise<string> {
    return await realpath(p);
  },

  /** Creates `link` pointing at `source`. */
  async symlink(source: string, link: string): Promise<void> {
    await symlink(source, link);
  },

  /** Null when `p` is missing or not a symlink. */
  async readLink(p: string): Promise<string | null> {
    try {
      const info = await lstat(p);
      if (!info.isSymbolicLink()) return null;
      return await readlink(p);
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  },
};
