import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The tools Tenbox starts that reach the network or a login; a test puts fakes of them in PATH. */
const REAL_TOOLS = ["claude", "gh", "docker"];
const SHADOW_ROOT = path.join(os.tmpdir(), `tenbox-test-path-${process.pid}`);

/** `PATH` without the real tools: a dir that holds one becomes a dir of links to all the rest. */
export function hermeticPath(searchPath: string): string {
  const dirs = searchPath.split(path.delimiter);
  return dirs.map((dir, i) => withoutRealTools(dir, i)).join(path.delimiter);
}

function withoutRealTools(dir: string, index: number): string {
  if (!REAL_TOOLS.some((tool) => existsSync(path.join(dir, tool)))) return dir;
  const shadow = path.join(SHADOW_ROOT, String(index));
  mkdirSync(shadow, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (!REAL_TOOLS.includes(name)) symlinkSync(path.join(dir, name), path.join(shadow, name));
  }
  return shadow;
}

export function removeHermeticPath(): void {
  rmSync(SHADOW_ROOT, { recursive: true, force: true });
}
