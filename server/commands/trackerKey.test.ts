import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const MAIN = path.join(import.meta.dir, "..", "main.ts");
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const CLICKUP_KEY = "pk_123_secret";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

const ResultSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  error: z.string().optional(),
  project: z.string().optional(),
  tracker: z.string().optional(),
});

interface Server {
  dbFile: string;
  keyFile: string;
}

interface Run {
  server: Server;
  args: string[];
  stdin: string;
}

function server(): Server {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-tracker-key-"));
  roots.push(root);
  const keyFile = path.join(root, "encryption.key");
  fs.writeFileSync(keyFile, `${ENCRYPTION_KEY}\n`);
  const dbFile = path.join(root, "server.db");
  const env = { ...process.env, TENBOX_SERVER_DB: dbFile };
  const args = ["--id", "k7f3qa", "--name", "demo", "--repo", "github.com/o/demo", "--org", "o"];
  Bun.spawnSync(["bun", "run", MAIN, "project", "add", ...args], { env });
  return { dbFile, keyFile };
}

function run(input: Run) {
  const { server: at, args, stdin } = input;
  const env = {
    ...process.env,
    TENBOX_SERVER_DB: at.dbFile,
    TENBOX_SERVER_ENCRYPTION_KEY_FILE: at.keyFile,
  };
  const proc = Bun.spawnSync(["bun", "run", MAIN, "project", "tracker-key", ...args], {
    env,
    stdin: Buffer.from(stdin),
  });
  const stdout = proc.stdout.toString();
  const result = ResultSchema.parse(JSON.parse(stdout));
  return { code: proc.exitCode, result, stdout };
}

function storedKey(file: string): string | null {
  const db = new Database(file, { readonly: true });
  const row = db
    .query<{ tracker_key: string | null }, []>("select tracker_key from projects")
    .get();
  db.close();
  return row?.tracker_key ?? null;
}

test("tracker-key reads the key on stdin, stores it sealed and prints no key", () => {
  const at = server();
  const args = ["--id", "k7f3qa", "--tracker", "clickup"];
  const { code, result, stdout } = run({ server: at, args, stdin: `${CLICKUP_KEY}\n` });
  expect(code).toBe(0);
  expect(result).toEqual({ ok: true, project: "k7f3qa", tracker: "clickup" });
  expect(stdout).not.toContain(CLICKUP_KEY);
  const sealed = storedKey(at.dbFile);
  expect(sealed).not.toBeNull();
  expect(sealed).not.toContain(CLICKUP_KEY);
});

test("an empty stdin, a tracker without a key or a missing --id is a usage error", () => {
  const at = server();
  const cases = [
    { args: ["--id", "k7f3qa", "--tracker", "clickup"], stdin: "  \n" },
    { args: ["--id", "k7f3qa", "--tracker", "github"], stdin: CLICKUP_KEY },
    { args: ["--tracker", "clickup"], stdin: CLICKUP_KEY },
  ];
  for (const each of cases) {
    const { code, result } = run({ server: at, ...each });
    expect(code).toBe(1);
    expect(result.code).toBe("usage");
  }
  expect(storedKey(at.dbFile)).toBeNull();
});

test("a project the server does not know is an error", () => {
  const at = server();
  const args = ["--id", "zzzzzz", "--tracker", "clickup"];
  const { code, result } = run({ server: at, args, stdin: CLICKUP_KEY });
  expect(code).toBe(1);
  expect(result.code).toBe("project-not-found");
});
