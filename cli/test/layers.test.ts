import { describe, expect, test } from "bun:test";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

interface LayerRule {
  /** Folder whose files are checked, relative to the repository root. */
  folder: string;
  /** Folders a relative import may reach. */
  allowed: string[];
  /** Extra folders that `*.test.ts` files may reach. */
  allowedInTests: string[];
}

const RULES: LayerRule[] = [
  { folder: "domain", allowed: ["domain"], allowedInTests: [] },
  { folder: "cli/infra", allowed: ["cli/infra", "domain"], allowedInTests: ["cli/test"] },
];

function relativeImports(source: string): string[] {
  const specifiers = [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? "");
  return specifiers.filter((specifier) => specifier.startsWith("."));
}

function isInside(target: string, folder: string): boolean {
  return target === folder || target.startsWith(`${folder}/`);
}

async function fileViolations(rule: LayerRule, file: string): Promise<string[]> {
  const relativeFile = path.posix.join(rule.folder, file);
  const source = await Bun.file(path.join(REPO_ROOT, relativeFile)).text();
  const allowed = file.endsWith(".test.ts")
    ? [...rule.allowed, ...rule.allowedInTests]
    : rule.allowed;
  return relativeImports(source)
    .filter((specifier) => {
      const target = path.posix.join(path.posix.dirname(relativeFile), specifier);
      return !allowed.some((folder) => isInside(target, folder));
    })
    .map((specifier) => `${relativeFile} imports "${specifier}"`);
}

async function violations(rule: LayerRule): Promise<string[]> {
  const files = [...new Bun.Glob("**/*.ts").scanSync({ cwd: path.join(REPO_ROOT, rule.folder) })];
  if (files.length === 0) return [`${rule.folder}: no .ts file found`];
  const found = await Promise.all(files.map((file) => fileViolations(rule, file)));
  return found.flat();
}

describe("layers", () => {
  for (const rule of RULES) {
    test(`${rule.folder} imports only ${rule.allowed.join(", ")}`, async () => {
      const found = await violations(rule);
      expect(found).toEqual([]);
    });
  }

  test("reads every import form", () => {
    const source = [
      'import { a } from "./a.ts";',
      'import type { B } from "./b.ts";',
      'export { c } from "./c.ts";',
      'import "./d.ts";',
      'const e = await import("./e.ts");',
      'import z from "zod";',
      'import { f } from "node:fs";',
      'import {\n  g,\n} from "../g.ts";',
    ].join("\n");
    expect(relativeImports(source)).toEqual([
      "./a.ts",
      "./b.ts",
      "./c.ts",
      "./d.ts",
      "./e.ts",
      "../g.ts",
    ]);
  });
});
