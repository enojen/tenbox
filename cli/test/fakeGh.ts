import { chmod } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { jsons } from "../../domain/utils.ts";
import { files } from "../infra/files.ts";

const EXECUTABLE = 0o755;

const FakeIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
  url: z.string(),
});

/** The issues the fake keeps per repository, as `tenbox task new` and `tenbox report` made them. */
const FakeStateSchema = z.object({ issues: z.array(FakeIssueSchema) });

type FakeIssue = z.infer<typeof FakeIssueSchema>;

/** A fake `gh` that keeps the issues and labels of each `--repo` in `GH_FAKE`. */
const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const dir = process.env.GH_FAKE;
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const repo = args.includes("--repo") ? flag("--repo") : "own/repo";
const file = dir + "/" + repo.replace("/", "_") + ".json";
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { issues: [], labels: ["feature"] };
const save = () => fs.writeFileSync(file, JSON.stringify(state));
fs.appendFileSync(dir + "/calls.log", args.join(" ") + "\\n");
if (args[0] === "api") console.log(fs.existsSync(dir + "/no-push") ? "false" : "true");
if (args[0] === "label" && args[1] === "list") console.log(JSON.stringify(state.labels.map((name) => ({ name }))));
if (args[0] === "label" && args[1] === "create") { state.labels.push(args[2]); save(); }
if (args[0] === "issue" && args[1] === "list") {
  const words = flag("--search").replace("in:title ", "").toLowerCase();
  const open = state.issues.filter((i) => i.state === "OPEN" && i.title.toLowerCase().includes(words));
  console.log(JSON.stringify(open.map(({ number, title, url }) => ({ number, title, url }))));
}
if (args[0] === "issue" && args[1] === "create") {
  const labels = args.flatMap((a, i) => (a === "--label" ? [args[i + 1]] : []));
  const missing = labels.find((l) => !state.labels.includes(l));
  if (missing) { console.error("could not add label: '" + missing + "' not found"); process.exit(1); }
  const number = state.issues.length + 1;
  state.issues.push({ number, title: flag("--title"), body: flag("--body"), labels, state: "OPEN",
    url: "https://github.com/" + repo + "/issues/" + number });
  save();
  console.log("https://github.com/" + repo + "/issues/" + number);
}
`;

export interface FakeGh {
  env: Record<string, string>;
  issues(repo: string): Promise<FakeIssue[]>;
  calls(): Promise<string>;
}

/** Installs the fake `gh` under `root`; `noPush` makes it a login without push access. */
export async function installFakeGh(root: string, noPush = false): Promise<FakeGh> {
  const bin = path.join(root, "bin");
  const state = path.join(root, "gh-state");
  await files.write(path.join(bin, "gh"), FAKE_GH);
  await chmod(path.join(bin, "gh"), EXECUTABLE);
  await files.write(path.join(state, ".keep"), "");
  if (noPush) await files.write(path.join(state, "no-push"), "");
  return {
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_FAKE: state, CLAUDECODE: "" },
    issues: async (repo) => {
      const text = await files.read(path.join(state, `${repo.replace("/", "_")}.json`));
      const result = jsons.check(FakeStateSchema, text ?? '{"issues":[]}');
      return result.ok ? result.value.issues : [];
    },
    calls: async () => {
      const log = await files.read(path.join(state, "calls.log"));
      return log ?? "";
    },
  };
}
