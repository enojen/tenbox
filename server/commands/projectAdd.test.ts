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
  code: z.string().optional(),
  error: z.string().optional(),
  project: z.object({ id: z.string() }).optional(),
  organization: z.object({ id: z.string(), name: z.string() }).optional(),
});

function run(dbFile: string, args: string[]) {
  const proc = Bun.spawnSync(["bun", "run", MAIN, "project", "add", ...args], {
    env: { ...process.env, TENBOX_SERVER_DB: dbFile },
  });
  const result = ResultSchema.parse(JSON.parse(proc.stdout.toString()));
  return { code: proc.exitCode, result };
}

function dbFile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-projectadd-"));
  roots.push(root);
  return path.join(root, "server.db");
}

function rows(file: string, table: string): number {
  const db = new Database(file, { readonly: true });
  const row = db.query<{ n: number }, []>(`select count(*) as n from ${table}`).get();
  db.close();
  return row?.n ?? 0;
}

const ARGS = [
  "--id",
  "k7f3qa",
  "--name",
  "tenbox",
  "--repo",
  "github.com/enojen/tenbox",
  "--org",
  "Acme",
];

test("project add prints the project and organization and stores one row", () => {
  const file = dbFile();
  const { code, result } = run(file, ARGS);
  expect(code).toBe(0);
  expect(result.ok).toBe(true);
  expect(result.project?.id).toBe("k7f3qa");
  expect(result.organization?.name).toBe("Acme");
  expect(rows(file, "projects")).toBe(1);
});

test("the same id again exits 1 with project-exists", () => {
  const file = dbFile();
  run(file, ARGS);
  const second = run(file, ARGS);
  expect(second.code).toBe(1);
  expect(second.result.code).toBe("project-exists");
  expect(second.result.error).toContain("k7f3qa");
  expect(rows(file, "projects")).toBe(1);
});

test("a missing flag is a usage error", () => {
  for (const flag of ["--id", "--name", "--repo", "--org"]) {
    const at = ARGS.indexOf(flag);
    const args = ARGS.filter((_, i) => i !== at && i !== at + 1);
    const { code, result } = run(dbFile(), args);
    expect(code).toBe(1);
    expect(result.code).toBe("usage");
  }
});

test("a bad id is a usage error and the database is never opened", () => {
  const file = dbFile();
  const { code, result } = run(file, ["--id", "K7F3QA!", ...ARGS.slice(2)]);
  expect(code).toBe(1);
  expect(result.code).toBe("usage");
  expect(fs.existsSync(file)).toBe(false);
});
