declare const git: {
  run(args: string[], cwd: string): Promise<string>;
  currentBranch(cwd: string): Promise<string>;
};
declare const shell: { run(command: string): Promise<string> };

export async function samples(dir: string): Promise<void> {
  const branch = await git.currentBranch(dir);
  await shell.run(branch);
}
