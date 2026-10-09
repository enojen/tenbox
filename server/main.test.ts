import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN_FILES = ["cli/main.ts", "server/main.ts"];
const SHEBANG = "#!/usr/bin/env bun";
const ROOT = join(import.meta.dir, "..");
const LOWEST_TEST_PORT = 20000;
const TEST_PORT_RANGE = 40000;

/** A random high port; a clash with another process is unlikely, not impossible. */
function freePort(): number {
  return LOWEST_TEST_PORT + Math.floor(Math.random() * TEST_PORT_RANGE);
}

describe("bin entry files", () => {
  test("every bin declared in package.json starts with the bun shebang", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const bins = Object.values(pkg.bin);
    expect(bins.sort()).toEqual(BIN_FILES);
    for (const file of bins) {
      const firstLine = readFileSync(join(ROOT, String(file)), "utf8").split("\n")[0];
      expect(firstLine).toBe(SHEBANG);
    }
  });
});

describe("the server process", () => {
  test("SIGTERM stops it cleanly with exit 0", async () => {
    const root = mkdtempSync(join(tmpdir(), "tenbox-main-"));
    const proc = Bun.spawn(["bun", join(ROOT, "server/main.ts")], {
      env: {
        ...process.env,
        TENBOX_SERVER_DB: join(root, "server.db"),
        TENBOX_SERVER_PORT: String(freePort()),
      },
      stderr: "pipe",
    });
    try {
      await waitForListening(proc.stderr);
      proc.kill("SIGTERM");
      const code = await proc.exited;
      expect(code).toBe(0);
    } finally {
      proc.kill();
      rmSync(root, { recursive: true });
    }
  });
});

/** Resolves when the server writes its `listening` line. */
async function waitForListening(stderr: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  let seen = "";
  for await (const chunk of stderr) {
    seen += decoder.decode(chunk);
    if (seen.includes("listening")) return;
  }
  throw new Error(`the server never listened: ${seen}`);
}
