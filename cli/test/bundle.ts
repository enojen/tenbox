import { rmSync } from "node:fs";
import path from "node:path";

const MAIN_TS = path.join(import.meta.dir, "..", "main.ts");

/** Two levels under the repo, as `cli/infra/env.ts` is, so `tenboxRoot` stays the repo;
 * `node_modules` keeps it out of git, Biome and knip. */
const BUNDLE_DIR = path.join(import.meta.dir, "..", "..", "node_modules", ".tenbox-test");
const BUNDLE_NAME = `main-${process.pid}.js`;

let built: Promise<string> | null = null;

/** `cli/main.ts` as one file, built once per test run: its start takes half the CPU. */
export function bundledMain(): Promise<string> {
  built ??= build();
  return built;
}

async function build(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [MAIN_TS],
    target: "bun",
    outdir: BUNDLE_DIR,
    naming: BUNDLE_NAME,
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
  return path.join(BUNDLE_DIR, BUNDLE_NAME);
}

/** `bun test` fires no `exit` event, so the preload removes the bundle after the last test. */
export function removeBundle(): void {
  rmSync(path.join(BUNDLE_DIR, BUNDLE_NAME), { force: true });
}
