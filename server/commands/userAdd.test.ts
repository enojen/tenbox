import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const MAIN = path.join(import.meta.dir, "..", "main.ts");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

const ResultSchema = z.object({
  ok: z.boolean(),
  token: z.string().optional(),
  type: z.string().optional(),
  user: z.object({ id: z.string() }).optional(),
  organization: z.object({ id: z.string() }).optional(),
});

function run(dbFile: string, args: string[]) {
  const proc = Bun.spawnSync(["bun", "run", MAIN, "user", "add", ...args], {
    env: { ...process.env, TENBOX_SERVER_DB: dbFile },
  });
  const result = ResultSchema.parse(JSON.parse(proc.stdout.toString()));
  return { code: proc.exitCode, result };
}

function dbFile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-useradd-"));
  roots.push(root);
  return path.join(root, "server.db");
}

const ENES = ["--name", "Enes", "--github", "enojen", "--org", "Acme"];

test("user add prints ids and a tbx_ token and stores the rows", () => {
  const file = dbFile();
  const { code, result } = run(file, ENES);
  expect(code).toBe(0);
  expect(result.ok).toBe(true);
  expect(result.type).toBe("member");
  expect(result.token).toStartWith("tbx_");
  expect(result.user?.id).toMatch(/^u-[a-z0-9]{6}$/);
  expect(result.organization?.id).toMatch(/^o-[a-z0-9]{6}$/);
  const db = new Database(file, { readonly: true });
  const row = db.query("select count(*) as n from memberships").get();
  expect(row).toEqual({ n: 1 });
});

test("the same github twice exits 1 with ok false", () => {
  const file = dbFile();
  run(file, ENES);
  const second = run(file, ENES);
  expect(second.code).toBe(1);
  expect(second.result.ok).toBe(false);
});

test("--type admin is stored and --type owner exits 1", () => {
  const file = dbFile();
  const admin = run(file, [...ENES, "--type", "admin"]);
  expect(admin.result.type).toBe("admin");
  const owner = run(file, ["--name", "B", "--github", "b", "--org", "Acme", "--type", "owner"]);
  expect(owner.code).toBe(1);
  expect(owner.result.ok).toBe(false);
});

test("a missing --org exits 1 with ok false", () => {
  const { code, result } = run(dbFile(), ["--name", "Enes", "--github", "enojen"]);
  expect(code).toBe(1);
  expect(result.ok).toBe(false);
});
