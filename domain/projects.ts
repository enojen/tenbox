import path from "node:path";
import { MAIN_CHECKOUT_DIR } from "./worktrees.ts";

export interface Project {
  /** `tenbox.yaml` `project:`, else the checkout's directory name, or its parent's when the checkout is `main`. */
  name: string;
  /** The main checkout, the directory that holds `.git`. */
  mainDir: string;
  /** The shared `.git` directory, the same from every linked worktree. */
  commonDir: string;
}

export function projectName(mainDir: string, manifestProject: string | undefined): string {
  if (manifestProject) return manifestProject;
  const base = path.basename(mainDir);
  return base === MAIN_CHECKOUT_DIR ? path.basename(path.dirname(mainDir)) : base;
}
