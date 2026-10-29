import { type FakeAnswer, fakeTool } from "./fakeTools.ts";

const OWN_REPO = "own/repo";
const OPEN = "OPEN";

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
  state: string;
}

/** The issues and labels of one repository, as `tenbox task new` and `tenbox report` made them. */
interface RepoState {
  issues: FakeIssue[];
  labels: string[];
}

export interface FakeGh {
  env: Record<string, string>;
  issues(repo: string): Promise<FakeIssue[]>;
  calls(): Promise<string>;
}

/** A fake `gh` in this process that keeps the issues and labels of each `--repo`; `noPush` makes
 * it a login without push access. */
export function installFakeGh(noPush = false): Promise<FakeGh> {
  const repos = new Map<string, RepoState>();
  const calls: string[] = [];
  const repoState = (repo: string): RepoState => {
    const state = repos.get(repo) ?? { issues: [], labels: ["feature"] };
    repos.set(repo, state);
    return state;
  };
  fakeTool("gh", (args) => {
    calls.push(args.join(" "));
    const repo = args.includes("--repo") ? flagOf(args, "--repo") : OWN_REPO;
    return answer({ args, repo, state: repoState(repo), noPush });
  });
  return Promise.resolve({
    env: { CLAUDECODE: "" },
    issues: (repo) => Promise.resolve(repos.get(repo)?.issues ?? []),
    calls: () => Promise.resolve(calls.map((call) => `${call}\n`).join("")),
  });
}

interface GhCall {
  args: string[];
  repo: string;
  state: RepoState;
  noPush: boolean;
}

function answer(call: GhCall): FakeAnswer {
  const { args, state, noPush } = call;
  const [group, action] = args;
  if (group === "api") return { stdout: `${!noPush}\n` };
  if (group === "label" && action === "list") {
    return { stdout: JSON.stringify(state.labels.map((name) => ({ name }))) };
  }
  if (group === "label" && action === "create") state.labels.push(args[2] ?? "");
  if (group === "issue" && action === "list") return { stdout: listIssues(state, args) };
  if (group === "issue" && action === "create") return createIssue(call);
  return {};
}

function listIssues(state: RepoState, args: string[]): string {
  const words = flagOf(args, "--search").replace("in:title ", "").toLowerCase();
  const open = state.issues.filter(
    (i) => i.state === OPEN && i.title.toLowerCase().includes(words),
  );
  return JSON.stringify(open.map((i) => ({ number: i.number, title: i.title, url: i.url })));
}

function createIssue(call: GhCall): FakeAnswer {
  const { args, repo, state } = call;
  const labels = args.flatMap((a, i) => (a === "--label" ? [args[i + 1] ?? ""] : []));
  const missing = labels.find((label) => !state.labels.includes(label));
  if (missing !== undefined)
    return { code: 1, stderr: `could not add label: '${missing}' not found` };
  const number = state.issues.length + 1;
  const url = `https://github.com/${repo}/issues/${number}`;
  state.issues.push({
    number,
    title: flagOf(args, "--title"),
    body: flagOf(args, "--body"),
    labels,
    url,
    state: OPEN,
  });
  return { stdout: `${url}\n` };
}

const flagOf = (args: string[], name: string): string => args[args.indexOf(name) + 1] ?? "";
