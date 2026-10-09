declare const processes: { run(args: string[]): Promise<string> };
declare const Other: { spawn(args: string[]): void };

export async function samples(): Promise<void> {
  await processes.run(["ls"]);
  Other.spawn(["ls"]);
}
