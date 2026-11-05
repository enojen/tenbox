import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  test("TENBOX_SERVER_HOST sets the bound address in the listening line", async () => {
    const root = mkdtempSync(join(tmpdir(), "tenbox-main-"));
    const port = freePort();
    const proc = Bun.spawn(["bun", join(ROOT, "server/main.ts")], {
      env: {
        ...process.env,
        TENBOX_SERVER_DB: join(root, "server.db"),
        TENBOX_SERVER_PORT: String(port),
        TENBOX_SERVER_HOST: "127.0.0.1",
      },
      stderr: "pipe",
    });
    try {
      const seen = await waitForListening(proc.stderr);
      expect(seen).toContain(`listening on http://127.0.0.1:${port}`);
    } finally {
      proc.kill();
      rmSync(root, { recursive: true });
    }
  });

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

/** Resolves with the stderr text when the server writes its `listening` line. */
async function waitForListening(stderr: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let seen = "";
  for await (const chunk of stderr) {
    seen += decoder.decode(chunk);
    if (seen.includes("listening")) return seen;
  }
  throw new Error(`the server never listened: ${seen}`);
}

describe("tenbox-server backup", () => {
  function runBackup(args: string[], dbFile: string) {
    return Bun.spawnSync(["bun", join(ROOT, "server/main.ts"), "backup", ...args], {
      env: { ...process.env, TENBOX_SERVER_DB: dbFile },
    });
  }

  /** A database of an older server: one table, none of the migrations of this one. */
  function writeOldDatabase(file: string): void {
    const client = new Database(file, { create: true });
    client.run("create table notes (text text)");
    client.run("insert into notes values ('kept')");
    client.close();
  }

  function tableNames(file: string): string[] {
    const client = new Database(file, { readonly: true });
    const rows = client
      .query<{ name: string }, []>("select name from sqlite_master where type = 'table'")
      .all();
    client.close();
    return rows.map((row) => row.name);
  }

  test("backup writes a copy of the live database", () => {
    const root = mkdtempSync(join(tmpdir(), "tenbox-main-"));
    try {
      const dbFile = join(root, "s.db");
      writeOldDatabase(dbFile);
      const to = join(root, "b", "x.db");
      const result = runBackup(["--to", to], dbFile);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({ ok: true, file: to });
      const copy = new Database(to, { readonly: true });
      expect(copy.query("select text from notes").all()).toEqual([{ text: "kept" }]);
      copy.close();
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("backup leaves the schema of the live database as it is", () => {
    const root = mkdtempSync(join(tmpdir(), "tenbox-main-"));
    try {
      const dbFile = join(root, "s.db");
      writeOldDatabase(dbFile);
      const result = runBackup(["--to", join(root, "x.db")], dbFile);
      expect(result.exitCode).toBe(0);
      expect(tableNames(dbFile)).toEqual(["notes"]);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("backup of a missing database fails and creates no database", () => {
    const root = mkdtempSync(join(tmpdir(), "tenbox-main-"));
    try {
      const dbFile = join(root, "missing", "s.db");
      const to = join(root, "x.db");
      const result = runBackup(["--to", to], dbFile);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout.toString()).code).toBe("no-database");
      expect(existsSync(dbFile)).toBe(false);
      expect(existsSync(to)).toBe(false);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("backup refuses an existing file", () => {
    const root = mkdtempSync(join(tmpdir(), "tenbox-main-"));
    try {
      const dbFile = join(root, "s.db");
      writeOldDatabase(dbFile);
      const to = join(root, "x.db");
      writeFileSync(to, "keep");
      const result = runBackup(["--to", to], dbFile);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout.toString()).code).toBe("backup-exists");
      expect(readFileSync(to, "utf8")).toBe("keep");
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  test("backup without --to prints the usage and exits 1", () => {
    const root = mkdtempSync(join(tmpdir(), "tenbox-main-"));
    try {
      const result = runBackup([], join(root, "s.db"));
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("backup --to <file>");
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
