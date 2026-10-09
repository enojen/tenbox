// Every line marked "lint:" must be reported by the rule.
declare const git: { run(args: string[], cwd: string): Promise<string> };

export async function samples(dir: string): Promise<void> {
  await git.run(["status"], dir); // lint: raw git command
  const head = await git.run(["rev-parse", "HEAD"], dir); // lint: raw git command
  console.log(head);
}
