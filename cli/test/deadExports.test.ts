import { describe, expect, test } from "bun:test";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const FOLDERS = ["cli", "domain", "server"];
const EXPORTED_NAME =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+(\w+)/gm;
const MODULE_OBJECT = /^export\s+const\s+([a-z]\w*)\s*=\s*\{/gm;
const TEST_HELPERS = "cli/test/";

/** The text of each `.ts` file, by path relative to the repository root. */
type SourceFiles = Record<string, string>;

interface ModuleObject {
  name: string;
  members: string[];
}

interface FileSources {
  production: string[];
  tests: string[];
}

function isTestFile(file: string): boolean {
  return file.endsWith(".test.ts");
}

function usesName(source: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(source);
}

function objectBody(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  return source.slice(open + 1);
}

function topLevelEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? "";
    if ("{([".includes(char)) depth += 1;
    if ("})]".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
}

function memberName(entry: string): string | null {
  return /^\s*(?:async\s+)?([A-Za-z_]\w*)\s*(?:[:(,]|$)/.exec(entry)?.[1] ?? null;
}

function moduleObjects(source: string): ModuleObject[] {
  return [...source.matchAll(MODULE_OBJECT)].map((match) => {
    const body = objectBody(source, match.index + match[0].length - 1);
    const members = topLevelEntries(body).map(memberName);
    return { name: match[1] ?? "", members: members.filter((m): m is string => m !== null) };
  });
}

function splitSources(files: SourceFiles, except: string): FileSources {
  const others = Object.keys(files).filter((file) => file !== except);
  return {
    production: others.filter((file) => !isTestFile(file)).map((file) => files[file] ?? ""),
    tests: others.filter(isTestFile).map((file) => files[file] ?? ""),
  };
}

function testOnlyExports(files: SourceFiles, file: string): string[] {
  const source = files[file] ?? "";
  const others = splitSources(files, file);
  const names = [...source.matchAll(EXPORTED_NAME)].map((match) => match[1] ?? "");
  return names
    .filter((name) => others.tests.some((test) => usesName(test, name)))
    .filter((name) => !others.production.some((other) => usesName(other, name)))
    .map((name) => `${file} ${name}`);
}

function unusedMembers(files: SourceFiles, file: string): string[] {
  const production = Object.keys(files)
    .filter((other) => !isTestFile(other))
    .map((other) => files[other] ?? "");
  return moduleObjects(files[file] ?? "").flatMap((object) =>
    object.members
      .filter(
        (member) => !production.some((other) => usesName(other, `${object.name}\\.${member}`)),
      )
      .map((member) => `${file} ${object.name}.${member}`),
  );
}

/** Exports and module object members that no production file uses; `cli/test/` helpers count as production callers. */
function deadExports(files: SourceFiles): string[] {
  return Object.keys(files)
    .filter((file) => !isTestFile(file) && !file.startsWith(TEST_HELPERS))
    .flatMap((file) => [...testOnlyExports(files, file), ...unusedMembers(files, file)]);
}

async function readSources(): Promise<SourceFiles> {
  const files = FOLDERS.flatMap((folder) =>
    [...new Bun.Glob("**/*.ts").scanSync({ cwd: path.join(REPO_ROOT, folder) })].map((file) =>
      path.posix.join(folder, file),
    ),
  );
  const sources = await Promise.all(
    files.map((file) => Bun.file(path.join(REPO_ROOT, file)).text()),
  );
  return Object.fromEntries(files.map((file, index) => [file, sources[index] ?? ""]));
}

describe("dead exports", () => {
  test("dead exports: a test-only export and a test-only module member are reported", () => {
    const files: SourceFiles = {
      "a.ts": [
        "export function only(): number { return 1; }",
        "const used = () => 1;",
        "const spare = () => 2;",
        "export const mod = { used, spare };",
      ].join("\n"),
      "a.test.ts": 'import { only, mod } from "./a.ts";\nonly();\nmod.spare();',
      "b.ts": 'import { mod } from "./a.ts";\nmod.used();',
    };
    expect(deadExports(files)).toEqual(["a.ts only", "a.ts mod.spare"]);
  });

  test("dead exports: a cli/test helper is a production caller", () => {
    const files: SourceFiles = {
      "cli/main.ts": "export function runCli(): void {}",
      "cli/test/inProcess.ts": 'import { runCli } from "../main.ts";\nexport const run = runCli;',
      "cli/main.test.ts": "runCli(); run();",
    };
    expect(deadExports(files)).toEqual([]);
  });

  test("dead exports: the repository has no test-only export", async () => {
    const sources = await readSources();
    expect(deadExports(sources)).toEqual([]);
  });
});
