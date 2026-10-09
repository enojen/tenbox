// Every line marked "lint:" must be reported by the rule.
export async function samples(): Promise<void> {
  const proc = Bun.spawn(["ls"], { stdout: "pipe" }); // lint: raw spawn
  await proc.exited;
  Bun.spawnSync(["ls"]); // lint: raw spawn
}
