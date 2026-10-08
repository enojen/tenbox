import { lstat, mkdir, readdir, readlink, stat, symlink } from "node:fs/promises";
import path from "node:path";

export const files = {
  async exists(p: string): Promise<boolean> {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  },

  async isDir(p: string): Promise<boolean> {
    try {
      const info = await stat(p);
      return info.isDirectory();
    } catch {
      return false;
    }
  },

  async read(p: string): Promise<string | null> {
    const file = Bun.file(p);
    const exists = await file.exists();
    return exists ? file.text() : null;
  },

  async write(p: string, text: string): Promise<void> {
    await mkdir(path.dirname(p), { recursive: true });
    await Bun.write(p, text);
  },

  async mkdir(p: string): Promise<void> {
    await mkdir(p, { recursive: true });
  },

  async list(p: string): Promise<string[]> {
    try {
      return await readdir(p);
    } catch {
      return [];
    }
  },

  async mtime(p: string): Promise<number> {
    const info = await stat(p);
    return info.mtimeMs;
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
    } catch {
      return null;
    }
  },
};
