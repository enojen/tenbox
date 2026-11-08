import { errorMessage } from "../../domain/errors/index.ts";
import { githubRepo, runTokenSecret } from "../../domain/runTokens.ts";
import type { Db } from "../infra/db/index.ts";
import { type GitHubApp, github } from "../infra/github.ts";
import { type KubernetesApi, kubernetes, type OpenJob } from "../infra/kubernetes.ts";
import { projectsRepository } from "../infra/repositories/projects.ts";
import type { Watching } from "./nodes.ts";

const POLL_INTERVAL_MS = 5000;

interface RunTokenWatch {
  kubernetes: KubernetesApi;
  github: GitHubApp;
  now: () => Date;
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
  const pollTokens = poller(db, input);
  let running: Promise<void> | null = null;
  const tick = () => {
    if (running !== null) return;
    running = pollTokens().finally(() => {
      running = null;
    });
  };
  tick();
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  return {
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
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
  const { db, job } = input;
  const { kubernetes: api, github: app, now } = input.input;
  const project = projectsRepository.findById(db, job.projectId);
  const repo = project === null ? null : githubRepo(project.repo);
  const token = await (repo === null ? null : github.repoToken({ app, repo, now: now() }));
  const name = runTokenSecret(job.name);
  await kubernetes.createSecret({ api, name, job, data: { token: token?.token ?? "" } });
  const to = repo === null ? "no repository" : `${repo.owner}/${repo.name}`;
  const until = token === null ? "no App token" : `until ${token.expiresAt}`;
  console.log(`run token of ${job.name}: ${to}, ${until}`);
}

export const runTokens = { poller, watch };
