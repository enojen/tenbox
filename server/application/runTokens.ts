import { errorMessage } from "../../domain/errors/index.ts";
import {
  GITHUB_HOSTS,
  githubRepo,
  runPlaceholder,
  runTokenSecret,
} from "../../domain/runTokens.ts";
import type { Db } from "../infra/db/index.ts";
import { type GitHubApp, github, type RepoToken } from "../infra/github.ts";
import { type KubernetesApi, kubernetes, type OpenJob } from "../infra/kubernetes.ts";
import { projectsRepository } from "../infra/repositories/projects.ts";
import { type Watching, watchers } from "./watchers.ts";

const POLL_INTERVAL_MS = 5000;
const RENEW_BEFORE_MS = 600_000;

export interface RunTokenWatch {
  kubernetes: KubernetesApi;
  github: GitHubApp;
  key: string;
  now: () => Date;
  tokens: Map<string, RepoToken>;
}

interface RunCredentialRequest {
  db: Db;
  watch: RunTokenWatch;
  placeholder: string;
  host: string;
}

interface JobToken {
  db: Db;
  job: OpenJob;
  input: RunTokenWatch;
}

async function poll(db: Db, input: RunTokenWatch, written: Set<string>): Promise<Set<string>> {
  const open = await kubernetes.openJobs(input.kubernetes);
  const results = await Promise.all(
    open.map((job) => (written.has(job.uid) ? true : writeLogged({ db, job, input }))),
  );
  return new Set(open.filter((_, index) => results[index]).map((job) => job.uid));
}

function poller(db: Db, input: RunTokenWatch): () => Promise<void> {
  let written = new Set<string>();
  return async () => {
    try {
      written = await poll(db, input, written);
    } catch (error) {
      console.error(`run token watch: ${errorMessage(error)}`);
    }
  };
}

function watch(db: Db, input: RunTokenWatch): Watching {
  return watchers.every({ intervalMs: POLL_INTERVAL_MS, tick: poller(db, input) });
}

async function writeLogged(input: JobToken): Promise<boolean> {
  try {
    await write(input);
    return true;
  } catch (error) {
    console.error(`run token of ${input.job.name}: ${errorMessage(error)}`);
    return false;
  }
}

async function write(input: JobToken): Promise<void> {
  const { job } = input;
  const { kubernetes: api, key } = input.input;
  const token = await mint(input);
  if (token !== null) input.input.tokens.set(job.uid, token);
  const name = runTokenSecret(job.name);
  const value = token === null ? "" : runPlaceholder(key, job.uid);
  await kubernetes.createSecret({ api, name, job, data: { token: value } });
  const until = token === null ? "no App token" : `token until ${token.expiresAt}`;
  console.log(`run token of ${job.name}: ${until}`);
}

function mint(input: JobToken): Promise<RepoToken | null> {
  const { db, job } = input;
  const { github: app, now } = input.input;
  const project = projectsRepository.findById(db, job.projectId);
  const repo = project === null ? null : githubRepo(project.repo);
  return repo === null ? Promise.resolve(null) : github.repoToken({ app, repo, now: now() });
}

async function resolve(input: RunCredentialRequest): Promise<string | null> {
  const { db, watch: watching, placeholder, host } = input;
  if (!GITHUB_HOSTS.includes(host)) return null;
  const open = await kubernetes.openJobs(watching.kubernetes);
  const job = open.find((candidate) => runPlaceholder(watching.key, candidate.uid) === placeholder);
  if (job === undefined) return null;
  const cached = watching.tokens.get(job.uid);
  const left = cached === undefined ? 0 : Date.parse(cached.expiresAt) - watching.now().getTime();
  if (cached !== undefined && left > RENEW_BEFORE_MS) return cached.token;
  const token = await mint({ db, job, input: watching });
  if (token === null) return null;
  forgetEnded(watching.tokens, open);
  watching.tokens.set(job.uid, token);
  return token.token;
}

function forgetEnded(tokens: Map<string, RepoToken>, open: OpenJob[]): void {
  const uids = new Set(open.map((job) => job.uid));
  for (const uid of tokens.keys()) if (!uids.has(uid)) tokens.delete(uid);
}

export const runTokens = { watch, resolve };
