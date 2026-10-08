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
  /** Adds `<wtRoot>/demo/<id>` on a new `feat/<id>` branch from `main`, with a `.tenbox/` directory. */
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
  const restoreEnv = setEnv(testEnv(root, wtRoot));
  await initRepo(mainDir, projectFiles);
  return {
    root,
    wtRoot,
    mainDir,
    addTaskWorktree: (id) => addTaskWorktree(mainDir, path.join(wtRoot, PROJECT, id)),
    remove: async () => {
      restoreEnv();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function testEnv(root: string, wtRoot: string): Record<string, string> {
  return {
    TENBOX_WT_ROOT: wtRoot,
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

async function addTaskWorktree(mainDir: string, taskWorktree: string): Promise<string> {
  const branch = `feat/${path.basename(taskWorktree)}`;
  await git.addWorktree({ mainDir, path: taskWorktree, branch, base: MAIN_BRANCH });
  await files.mkdir(path.join(taskWorktree, ".tenbox"));
  return taskWorktree;
}
