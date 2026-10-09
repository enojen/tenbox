import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** One folder under `rules/`: `rule.grit`, `bad.ts`, `good.ts`, `rule.md`. */
type RuleName = string;
type SampleName = "bad.ts" | "good.ts";

/** The part of one diagnostic in Biome's `--reporter=json` output this test reads. */
interface Diagnostic {
  category: string;
  location: { start: { line: number } };
}

interface LintReport {
  diagnostics: Diagnostic[];
}

interface Sample {
  rule: RuleName;
  sample: SampleName;
}

const RULES_DIR = import.meta.dir;
const REPO_DIR = path.dirname(RULES_DIR);
/** A comment that marks a line of `bad.ts` the rule must report. */
const LINT_MARKER = "// lint:";
const PLUGIN_CATEGORY = "plugin";
const RULE_TIMEOUT_MS = 30_000;

const ruleNames: RuleName[] = readdirSync(RULES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const tempDirs: string[] = [];

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** A Biome config that holds only this rule, so a sample fails for this rule alone. */
function configFor(rule: RuleName): string {
  return JSON.stringify({
    linter: { enabled: true, rules: { recommended: false } },
    plugins: [path.join(RULES_DIR, rule, "rule.grit")],
  });
}

/** The 1-based lines Biome reports for one sample under its rule alone. */
async function reportedLines({ rule, sample }: Sample): Promise<number[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tenbox-rule-"));
  tempDirs.push(dir);
  const file = path.join(dir, sample);
  await copyFile(path.join(RULES_DIR, rule, sample), file);
  await writeFile(path.join(dir, "biome.json"), configFor(rule));
  const args = ["bunx", "biome", "lint", `--config-path=${dir}`, "--reporter=json", file];
  const proc = Bun.spawn(args, { cwd: REPO_DIR, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  if (stdout === "") throw new Error(`biome lint printed no report: ${stderr}`);
  const report: LintReport = JSON.parse(stdout);
  const lines = report.diagnostics
    .filter((d) => d.category === PLUGIN_CATEGORY)
    .map((d) => d.location.start.line);
  return [...new Set(lines)].sort((a, b) => a - b);
}

/** The 1-based lines of a sample that carry the lint marker. */
async function markedLines({ rule, sample }: Sample): Promise<number[]> {
  const text = await readFile(path.join(RULES_DIR, rule, sample), "utf8");
  return text
    .split("\n")
    .map((line, index) => (line.includes(LINT_MARKER) ? index + 1 : 0))
    .filter((line) => line > 0);
}

describe.each(ruleNames)("rule %s", (rule) => {
  test(
    "reports every marked line of bad.ts and no other",
    async () => {
      const sample: Sample = { rule, sample: "bad.ts" };
      const marked = await markedLines(sample);
      const reported = await reportedLines(sample);
      expect(marked.length).toBeGreaterThan(0);
      expect(reported).toEqual(marked);
    },
    RULE_TIMEOUT_MS,
  );

  test(
    "reports nothing in good.ts",
    async () => {
      const reported = await reportedLines({ rule, sample: "good.ts" });
      expect(reported).toEqual([]);
    },
    RULE_TIMEOUT_MS,
  );
});
