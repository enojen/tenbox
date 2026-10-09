import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { files } from "../infra/files.ts";
import { git } from "../infra/git.ts";

/** File path relative to the main checkout, mapped to its text. */
export type ProjectFiles = Record<string, string>;

/** A temp worktree root with `demo/main`, a git repo on `main`, and the env pointing at it. */
export interface TempProject {
  root: string;
  wtRoot: string;
  mainDir: string;
  /** `TENBOX_HOME`, under the temp root. */
  tenboxHome: string;
  /** Adds `<wtRoot>/demo/<id>` on a new `feat/<id>` branch from `main`, with `.tenbox` linked to a task dir. */
  addTaskWorktree(id: string): Promise<string>;
  /** Removes the temp root and restores the env variables. */
  remove(): Promise<void>;
}

const PROJECT = "demo";
const MAIN_BRANCH = "main";
const GIT_AUTHOR = "tenbox-test";
const GIT_EMAIL = "tenbox-test@example.com";

export async function makeTempProject(projectFiles: ProjectFiles): Promise<TempProject> {
  const root = await mkdtemp(path.join(os.tmpdir(), "tenbox-test-"));
  const wtRoot = path.join(root, "wt");
  const mainDir = path.join(wtRoot, PROJECT, MAIN_BRANCH);
  const tenboxHome = path.join(root, "tenbox-home");
  const restoreEnv = setEnv(testEnv({ root, wtRoot, tenboxHome }));
  await initRepo(mainDir, projectFiles);
  return {
    root,
    wtRoot,
    mainDir,
    tenboxHome,
    addTaskWorktree: (id) => addTaskWorktree(mainDir, path.join(wtRoot, PROJECT, id), tenboxHome),
    remove: async () => {
      restoreEnv();
      await rm(root, { recursive: true, force: true });
    },
  };
}

interface TempPaths {
  root: string;
  wtRoot: string;
  tenboxHome: string;
}

function testEnv({ root, wtRoot, tenboxHome }: TempPaths): Record<string, string> {
  return {
    TENBOX_WT_ROOT: wtRoot,
    TENBOX_HOME: tenboxHome,
    WTBASE_DIR: path.join(root, "baselines"),
    CLAUDE_CONFIG_DIR: path.join(root, "claude"),
    GIT_AUTHOR_NAME: GIT_AUTHOR,
    GIT_AUTHOR_EMAIL: GIT_EMAIL,
    GIT_COMMITTER_NAME: GIT_AUTHOR,
    GIT_COMMITTER_EMAIL: GIT_EMAIL,
  };
}

/** Sets the variables and returns the function that puts the old values back. */
function setEnv(values: Record<string, string>): () => void {
  const previous = Object.keys(values).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, values);
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function initRepo(mainDir: string, projectFiles: ProjectFiles): Promise<void> {
  await files.mkdir(mainDir);
  for (const [name, text] of Object.entries(projectFiles)) {
    await files.write(path.join(mainDir, name), text);
  }
  await git.run(["init", "-q", "-b", MAIN_BRANCH], mainDir);
  await git.run(["add", "-A"], mainDir);
  await git.run(["commit", "-q", "--allow-empty", "-m", "init"], mainDir);
}

async function addTaskWorktree(
  mainDir: string,
  taskWorktree: string,
  tenboxHome: string,
): Promise<string> {
  const id = path.basename(taskWorktree);
  await git.addWorktree({ mainDir, path: taskWorktree, branch: `feat/${id}`, base: MAIN_BRANCH });
  const taskDir = path.join(tenboxHome, PROJECT, id);
  await files.mkdir(taskDir);
  await files.symlink(taskDir, path.join(taskWorktree, ".tenbox"));
  return taskWorktree;
}
