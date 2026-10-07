import { lstat, mkdir, readdir, readlink, stat, symlink } from "node:fs/promises";
import path from "node:path";
import type { Files } from "../ports.ts";

export const files: Files = {
  async exists(p) {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  },
  async isDir(p) {
    try {
      return (await stat(p)).isDirectory();
    } catch {
      return false;
    }
  },
  async read(p) {
    const f = Bun.file(p);
    return (await f.exists()) ? f.text() : null;
  },
  async write(p, text) {
    await mkdir(path.dirname(p), { recursive: true });
    await Bun.write(p, text);
  },
  async mkdir(p) {
    await mkdir(p, { recursive: true });
  },
  async list(p) {
    try {
      return await readdir(p);
    } catch {
      return [];
    }
  },
  async mtime(p) {
    return (await stat(p)).mtimeMs;
  },
  async symlink(source, link) {
    await symlink(source, link);
  },
  async readLink(p) {
    try {
      if (!(await lstat(p)).isSymbolicLink()) return null;
      return await readlink(p);
    } catch {
      return null;
    }
  },
};
