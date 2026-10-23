# Tenbox: target design

One dev server, many Claude Code agents, one task at a time from Linear to merge.

Tenbox is a thin layer on top of Claude Code. Claude Code already does the hard parts:
agents, roles, orchestration, worktrees, hooks. Tenbox adds what a real task needs
around them:

- **Roles**: planner, worker, reviewer, QA, defined as Claude Code custom subagents.
- **Workflows**: three saved Claude Code workflows that run a task through its stages.
- **A project manifest**: `tenbox.yaml`, which says how to run each project's services.
- **A sandbox**: the full stack of a project, started only when the work is ready to try.
- **A small CLI**: `tenbox`, for the things an LLM should not improvise (worktrees,
  sandboxes, checks, PRs).
- **Gates**: you approve the plan and the result; GitHub CI decides if the code merges.

> **This is the target design, not today's behaviour.** What is built and how it runs today
> is in the [reference](reference.md); where the two differ, the reference describes the code.
> Tenbox grows out of devbox, an earlier private setup: `wtport`, `wtbase`, `heavy`, Caddy
> `p<port>` links and the `/task-start` / `/task-close` skills.

## The idea in one picture

```
Linear task TEN-301
   │
   │  tenbox start TEN-301        worktree + branch + one background claude session
   ▼
┌─ claude session "tenbox-TEN-301" (claude --bg, cwd = task worktree) ─────────────────┐
│                                                                                     │
│  /tenbox-plan TEN-301    workflow: planner agents → .tenbox/plan.md                  │
│        │                                                                            │
│        ▼  👤 you read the plan, answer questions, approve                            │
│                                                                                     │
│  /tenbox-build TEN-301   workflow: build → checks → review → try, loops on failure  │
│        │                   workers (own worktrees) · reviewers · QA in the sandbox  │
│        ▼  👤 you read the PR, try the sandbox links, approve or send back            │
│                                                                                     │
│  /tenbox-close TEN-301   workflow: merge after CI is green, clean up, Linear → Done  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**One Claude Code session per task.** You talk to it like any session. It runs the
workflows; the workflows run the agents. The workflow script is the master: it holds the
loop, the order and the intermediate results, so no agent has to coordinate the others
and the session's own context stays small.

## Why workflows

Claude Code has four ways to run multi-step work. Tenbox uses workflows for the task
pipeline because the plan lives in code:

| | Subagents | Skills | Agent teams | **Workflows** |
|---|---|---|---|---|
| Who decides what runs next | Claude, each turn | Claude, following text | A lead agent | **The script** |
| Where results live | Claude's context | Claude's context | Shared task list | **Script variables** |
| Repeatable | The worker | The instructions | The team | **The whole orchestration** |
| Interrupted | Turn restarts | Turn restarts | Teammates keep going | **Resumes where it stopped** |
| Worktree per agent | Yes | n/a | No | **Yes** |

What this gives Tenbox for free: loops that cannot skip a step, parallel workers in
their own worktrees, reviewer panels, one QA agent per acceptance criterion, resume after
a crash, and an automatic wait when the subscription limit is hit.

What workflows cannot do, and how Tenbox handles it:

| Limit | Tenbox answer |
|---|---|
| No user input during a run | Split the task into three workflows at the points where you decide |
| The script cannot touch files or run commands | Agents run `tenbox ...` commands; the script only coordinates |
| You cannot chat with one agent inside a run | Talk to the task session between runs; stop or restart single agents in `/workflows` |
| Every step is done by an LLM, so a step could be faked | The hard gate is GitHub CI with branch protection, not an agent's report |
| Resume works only in the same session (`resumeFromRunId`, longest unchanged prefix of `agent()` calls) | Keep the task session alive; a new session reruns the workflow, and agents reread `.tenbox/` so finished parts are skipped by the planner, not by the cache |
| No `Date.now()`, `Math.random()` or `new Date()` in a script (they break resume) | Timestamps come from `tenbox` command output, never from the script |

## The steps

| # | Step | Who | Where | Output | Gate |
|---|---|---|---|---|---|
| 1 | Start | `tenbox start` | task machine | worktree, branch, `.tenbox/`, task session | |
| 2 | Plan | `/tenbox-plan` | task session | `.tenbox/plan.md`, questions | 👤 you approve |
| 3 | Build | workers | task worktree, or one worktree each | commits, `.tenbox/parts/*.md` | |
| 4 | Checks | `tenbox check` | task worktree | `.tenbox/rounds/N/checks.json` | no new failures |
| 5 | Review | reviewer panel | task worktree, read-only | `.tenbox/rounds/N/review.json`, draft PR | no must-fix |
| 6 | Try | QA agents | **sandbox**, pinned commit | `.tenbox/rounds/N/qa/` | every criterion passes |
| 7 | You | you | sandbox links, attention list, QA evidence | approve or request changes | 👤 you approve |
| 8 | Close | `/tenbox-close` | task session | merged PR, machine and volume removed, Linear Done | CI green |

Steps 3 to 6 are one workflow, `/tenbox-build`. A failure in 4, 5 or 6 becomes feedback
for the next round of step 3. After `max_rounds` the workflow stops and reports to you.
When you send the work back in step 7, your PR comments become the feedback for the next
`/tenbox-build` run. Comment on behaviour, not on hunks: "no mail after cancel" is
enough, the next round finds the file.

### Keeping you out of the bottleneck

Reading every line of a large PR does not scale, and it is not your job: three reviewers,
CI and QA already read the code. What only you can judge is whether the product is right.
Three rules keep step 7 small:

1. **Small PRs, decided at plan time.** `budget.max_pr_lines` in `tenbox.yaml` (default
   400). A plan that exceeds it is split into groups, one PR each, every one from `main`;
   no stacked PRs. You approve the split at the plan gate, so you never meet a 2000-line
   PR at the end.
2. **An attention list, not a diff.** The reviewer panel marks the hunks that need a human
   eye in `review.json` (`attention`), and `tenbox pr` puts them at the top of the PR
   body with a one-line reason. What counts as attention is a rule, not a judgement:
   migrations, auth, deletions, OpenAPI changes, files near `locked`, files not in the
   plan. Everything else is tests and plain code that the panel and CI cover.
3. **Behaviour over code.** Your gate is the sandbox and the QA evidence: try the feature,
   read the attention hunks, check that `rounds/N/qa/` shows what the criteria ask for.
   Product decisions were already taken in `decisions.md` at step 2; step 7 only asks
   "is this what I expected?".

## Where things run

Nothing runs on your computer and nothing runs all day. Each tenbox command of a task runs
as a **Job** on a small Kubernetes cluster, [Tenyard](https://github.com/enojen/tenyard);
its pod is the **box**. Each task keeps a small **volume** that lives from `tenbox start`
to `tenbox close`. See [Machines](#machines).

```
cluster tenyard (k3s)                       one node today; more nodes while tasks wait
├ Job task-ten-301-<MMDD-HHMMSS>            one tenbox command; gone 10 minutes after it ends
│  └ pod: the box image                     ghcr.io/enojen/tenbox-box
│     ├ /home/tenbox → volume task-ten-301  10 GB · exists per task
│     │  ├ wt/my-app/main/             clone of the project, made on the first run
│     │  ├ wt/my-app/TEN-301/          task worktree, branch feat/TEN-301
│     │  ├ .tenbox/<project id>/TEN-301/    the task's shared memory
│     │  └ .claude/                         session transcripts
│     ├ claude --bg                         one session, cwd = task worktree
│     └ sandbox                             the full stack, steps 6 and 7 only
├ Job task-ten-302-…                        the next task, on the same node
└ Secrets                                   the login, the GitHub token, the tracker key, ntfy
```

All agents are normal Claude Code subagents started by the workflow inside the task
session, with your subscription login. Your computer only sends commands and reads
results; your phone sees every session through Remote Control.

## Machines

**Compute per run, disk per task.** A run is one tenbox command on one task: plan, build,
close. It is one Kubernetes Job. Its pod ends when the command and the claude session it
left behind are done; a session that waits for you (a plan before approval) counts as done
after one idle minute. `plan-ready`, `ready-for-you` and `needs-you` all end a run; you can
take an hour or a week, nothing is lost. The task's state lives on its volume, so the next
command is a new Job on the same volume and resumes the session. A task has one run at a
time, because its volume mounts on one pod.

**Shared nodes, burst per task.** An agent waits for the model most of the time. So a Job
asks for little (0.5 CPU, 2 GiB) and may use much (4 CPU, 5 GiB): several tasks share a
node, and the one that runs its tests gets full cores. The node is billed, not the task.

| Piece | Lifetime | Holds |
|---|---|---|
| image `ghcr.io/enojen/tenbox-box` | until the next merge to main | Ubuntu, bun, gh, claude, tenbox at `/opt/tenbox`, `boot.sh` |
| Job `task-<id>-<MMDD-HHMMSS>` | one run, then 10 minutes | nothing of its own |
| volume `task-<id>` | start to close | worktrees, `.tenbox/`, `.claude/` |
| Secrets in namespace `tenbox` | until the next login sync | the login, the GitHub token, the tracker key, the ntfy URL |

**One command from your computer:**

```
tenbox machine run TEN-301 -- tenbox build TEN-301
```

It fills Tenyard's `task/pvc.yaml` and `task/job.yaml` and posts the volume and the Job to
the Kubernetes API with `fetch`; no `kubectl`, no Actions, no cloud API. `tenbox machine
ls` lists the Jobs. The line between the two repositories: what is inside the box (the
image) belongs to Tenbox; where and how the box runs (the cluster, the nodes, the Job, the
volume) belongs to Tenyard.

**Next, step by step (Tenyard):**

- Resource classes `plan`, `build` and `heavy`: a plan needs little; `tenbox check` runs as
  its own `heavy` Job on the task volume.
- The sandbox next to the session, for steps 6 and 7: sidecars of the Job, or one compose
  project inside the box.
- Nodes that join while Jobs wait and leave when they are empty; a queue caps the parallel
  tasks.
- Volume snapshots; `close` removes the volume.
- A preview URL per task for the Try phase.

**Login.** Remote Control needs a claude.ai login; `claude setup-token` runs the model
but Remote Control refuses it (`Remote Control disconnected — /login`). A copy of
`~/.claude/.credentials.json` works. Your computer writes the file to the Secret
`claude-credentials` whenever it changes, and every Job reads the Secret of the moment. The
access token lives hours and a run is shorter; the refresh token lives days, so `tenbox
machine run` checks its expiry first and asks for `/login` instead of starting a box that
cannot connect.

**Session links.** Every session connects Remote Control by itself
(`remoteControlAtStartup`) and shows up in the Claude app under its name,
`tenbox-TEN-301`. The link is `https://claude.ai/code/<bridgeSessionId>`, read from
`~/.claude/sessions/<pid>.json`. A resumed session gets a new id and a new link, so each
notification carries the link of the moment, as the ntfy `Click` header: one tap opens the
session in the app.

**CI runners.** The self-hosted CI runner shares the cluster's node for now. A CI job can
become a Job on the cluster later, so that nothing runs all day.

**What a project needs:** `tenbox.yaml` and its origin on GitHub. The secrets live in the
cluster: the login, one GitHub token that reads every project, the tracker key.

**Limits.** Compute scales with the number of tasks; the subscription does not. Four
builds at once burn tokens at once, so the cap on parallel tasks is a tenbox setting, not
a cloud one. Until volume snapshots come, the code is on GitHub and `.tenbox/` and
`.claude/` live only on the volume.

**Plan here or there.** A plan takes two minutes and little CPU, and it is where you want
control: `tenbox start` runs it on your computer, or as a light Job with `tenbox machine
run <id> -- tenbox start <id>`. The build runs on the cluster. The cluster is a build farm,
nothing more.

## The babysitter

One agent you talk to. It is a `claude --bg` session with Remote Control, on your computer
first, with a `babysitter` role and a `/tenbox-babysit` skill that wakes up about every
five minutes. It is a router and a scheduler, not a worker:

- **Runs the tree.** A feature is a parent issue with sub-issues and `blocked by`
  relations in Linear; `tenbox feature import TEN-430` copies it to the server one way.
  The babysitter starts the tasks whose blockers are closed, in waves: one Job per task,
  placed by the cluster. When an approval, answer or merge arrives for a task with no
  running Job, it starts one for that task.
- **Collects questions.** `plan-ready`, `needs-you`, `ready-for-you` and `pr-opened` of
  every task go into one numbered message.
- **Routes answers.** "1 approve, 2 option B, 3 A plus a note" becomes `tenbox approve`,
  `decide` and `answer`, posted to the server. The task pulls them in `tenbox wait` or at
  boot. The babysitter never enters a box; no `kubectl exec`.
- **Reports every action** in one line, and answers "status?": task states, Jobs
  running, what waits on you.
- **Decides nothing.** Product, contract and risk cards go to you. It never reviews code.
  It never merges: when CI is green it asks; you merge (one question per PR).

**System of record: the server.** The events and task tables of
[`data-model.md`](data-model.md) tell it where every task stands. Next to them the server
gets `features` with `task_deps` (the tree) and `answers` (approvals, decisions and
answers written by the babysitter, pulled by the task). The server forwards the events
that need a person to ntfy. It runs on the cluster; it never enters a box and never runs
code.

```
  task Job ──POST event──▶ server ──▶ ntfy (phone)
      ▲                      │  ▲
      │ pull answers at boot │  │ GET feature / POST answer
      │                      ▼  │
 Kubernetes API ◀── tenbox machine run ── babysitter ◀──▶ you (Claude app)
```

Build order: the events of `data-model.md`; features and import; answers on the server
with `tenbox wait`; the babysitter role and skill; the wave rule moves into the server
last.

## Parallel work

Two levels, and the first one is the one that matters:

| Level | Unit | Runs in parallel as | Joins at |
|---|---|---|---|
| **Task** | one tracker task = one worktree = one session = one PR | several task sessions side by side, started by you | `/tenbox-close`, rebase on `main` |
| **Part** | one piece of a task's plan | workers in their own worktrees (`isolation: 'worktree'`), step 3 only | the `integrator`, into the task branch |

Tasks are the unit of parallelism: independent tasks cannot conflict, each gets its own
PR and its own approval. Parts only make one task faster and end up on the same branch,
so the planner splits into parts only when the parts touch different files.

**File ownership is the rule.** Every part file lists its `files:`. Two parts that need
the same file become one part. The same rule applies across tasks: the planner reads the
`plan.md` of every other active task (`~/wt/<project>/*/.tenbox/plan.md`) and warns you
at the plan gate when two tasks touch the same files, so you can run them in sequence.

**Who splits the work:**

- You, in the tracker: a parent task becomes independent subtasks, and Tenbox runs each
  one. This is the normal path.
- The planner, at the plan gate: a task over `budget.max_pr_lines` is proposed as
  subtasks; after you approve, `tenbox` creates them in the tracker through the adapter.

Start with two or three tasks at once. Each task has its own machine; what they share is
one subscription limit.

## Tracker

The Linear and ClickUp adapters are built (see the reference). The target adds
`createSubtask(parent, title, description)` to the `Tracker` port, so that `tenbox` can
create the subtasks the planner proposes. The compose project of a task is `tenbox-<id>`.

## Roles: `.claude/agents/`

Each role is a Claude Code custom subagent: a Markdown file with frontmatter. The
workflow picks one with `agentType`. Roles live in `~/.claude/agents/` so every project
gets them; a project can override one in its own `.claude/agents/`.

| Role | Does | Key settings |
|---|---|---|
| `planner` | Reads the task, code and spec. Writes the plan, the acceptance criteria and the questions. Splits the work into parts, and into stacked PRs when it exceeds `budget.max_pr_lines`. | `Write`, `Edit` only under `.tenbox/`: a frontmatter field cannot scope a tool to a path, so the prompt sets the rule and a `PreToolUse` hook enforces it later; `model: opus`, `effort: medium` |
| `worker` | Builds one part: code and unit tests. Commits. Writes its result file. | full tools; `permissionMode: acceptEdits` so a round does not stop on edit prompts; locked paths blocked by hook; `model: sonnet`, `opus` for a part the planner marks hard |
| `integrator` | Merges parallel worker branches into the task branch. Resolves simple conflicts. | git only |
| `reviewer` | Reads the diff against the plan through one lens. Marks hunks for the attention list. Never edits. | `disallowedTools: Edit, Write`; `model: sonnet`, `opus` for the security lens |
| `qa` | Black-box tester. Tests one acceptance criterion against the sandbox. Never reads code. | Bash + Playwright MCP; code reads blocked by hook |
| `runner` | Runs one `tenbox` command and returns its JSON unchanged. | `model: sonnet`, `effort: low`, Bash only |

## Shared memory: `.tenbox/`

Agents in one run do not talk to each other. They share the task files (see the
reference). The target adds two things per round:

```
.tenbox/rounds/2/
├ review.json           merged reviewer panel result: must_fix, nice_to_have, attention
└ qa/                   one report per criterion + evidence (requests, screenshots, logs)
```

The `attention` part of `review.json`, what goes to the top of the PR body:

```json
"attention": [
  { "file": "src/order/cancel.ts", "lines": "41-58", "why": "transaction boundary, 409 race" },
  { "file": "migrations/0012.sql", "why": "schema change, not reversible" },
  { "file": "openapi.yaml", "why": "contract change, new 409 response" }
]
```

## The workflows

`/tenbox-plan`, `/tenbox-build` and `/tenbox-close` are built (see the reference). The
target changes two of them:

- **`/tenbox-build` gets the Try phase** after Review: `tenbox sandbox up` pins the
  commit, the planner lists the acceptance criteria, one `qa` agent tests each criterion
  against the sandbox, and a failure is re-tested by a second, independent `qa` agent
  before it counts. Failed criteria become the feedback of the next round. Parts that run
  in parallel get their own worktrees (`isolation: 'worktree'`), and the `integrator`
  merges them into the task branch.
- **`/tenbox-close`** waits for green CI, squash-merges the PR, writes the tracker
  work-log comment, and proposes project-wide decisions for the project `CLAUDE.md`.

## The CLI: `tenbox`

The commands still to build:

| Command | Does |
|---|---|
| `tenbox sandbox up <TEN-xx> --profile try` | Pins `HEAD`, builds from that commit, `compose up`, seeds, waits for health, prints links |
| `tenbox sandbox stop/down <TEN-xx>` | Pause (keep volumes) or remove |
| `tenbox init` | Claude Code reads the repo (lockfiles, `package.json`, compose files) and writes a draft `tenbox.yaml`; the CLI never guesses a project's tooling itself |
| `tenbox validate` | Checks `tenbox.yaml`: schema, kinds, `${...}` references, `depends_on` cycles |

`tenbox close` also takes the sandbox down, and `tenbox list` shows whether it is up.

## Project manifest: `tenbox.yaml`

Every project runs different services. The manifest describes them so the CLI can start
them per task without hand-written config. It separates three things: how a service
**looks** (`kind`), how it **starts** (`run`), and how services **connect** (references
Tenbox fills in).

```yaml
version: 1
project: my-app

sandbox:
  compose: tenbox/compose.yaml           # optional; services can also be plain processes
  egress: [api.anthropic.com, registry.npmjs.org]

services:
  api:
    kind: api
    run: { compose: api }                # a service in the compose file
    port: 4000                           # the app's own port; Tenbox picks the host port
    health: { http: /health, timeout: 60s }
    openapi: /openapi.json
    depends_on: [db, stripe]
    env:
      DATABASE_URL: ${db.url}
      STRIPE_BASE_URL: ${stripe.url}

  panel:
    kind: web
    run: { cmd: pnpm dev, cwd: apps/panel }   # a plain process, logs collected by Tenbox
    port: 5173
    env: { VITE_API_URL: ${api.url} }

  db:
    kind: postgres
    run: { compose: db }
    seed: pnpm db:seed
    viewer: pgweb

  stripe:
    kind: fake
    run: { cmd: bun fakes/stripe.ts }
    spec: fakes/stripe.openapi.yaml
    scenarios: [success, card_declined, timeout_30s]

  mailer:
    kind: custom
    icon: mailbox
    run: { compose: mailer }
    actions:
      - { label: "Send test mail", cmd: "pnpm mail:test" }

profiles:
  dev: [db]                              # optional during Build, for integration tests
  try: [api, panel, db, stripe, mailer]  # step 6, the full stack

try:
  seed: pnpm db:seed:demo
  accounts: [buyer@demo.test, supplier@demo.test]
  notes: tenbox/try.md                   # your "how to try" guide

checks:
  types: pnpm tsc --noEmit
  lint:  pnpm lint
  unit:  pnpm test --run
failure_pattern: "(^|\\s)FAILED(\\s|$)"   # optional: what a failing line looks like; the default knows vitest, jest, bun and tsc

locked: [openapi.yaml, e2e/, tenbox.yaml]
budget: { max_rounds: 3, max_parallel_workers: 3, max_pr_lines: 400 }
names: { branch: "feat/{id}" }          # optional; this is the default
base: main                               # optional: the branch tasks start from and merge into
```

**`run`** has three forms:

| `run` | Use for |
|---|---|
| `{ compose: <service> }` | A service already in a compose file. Compose stays the single source; the manifest does not repeat it |
| `{ cmd: ..., cwd: ... }` | Dev servers, fakes, scripts. Tenbox starts the process and keeps its log |
| `{ external: host:port }` | Something shared that Tenbox only watches, never starts |

**`kind`** gives defaults for icon, health check and panel tab: `web`, `api`, `postgres`,
`mongo`, `redis`, `queue`, `fake`, `worker`, `custom`. Any field in the manifest replaces
the default. `custom` lets you pick the icon, tabs and action buttons yourself.

**References** like `${db.url}` and `${api.port}` are filled in per task. Nothing is
configured by hand, so two tasks can never share a database by accident (the TEN-53 /
TEN-62 bug).

**Layers**, later ones win:

```
kind defaults → tenbox.yaml (repo) → tenbox.local.yaml (gitignored, secrets) → .tenbox/override.yaml (this task)
```

Agents cannot edit `tenbox.yaml`; it is in `locked`. If an agent needs a new service it
asks you.

Other projects use the same panel and CLI with different services:

```yaml
# booking-api              # ext
services:                             services:
  api:    { kind: api, ... }            extension:
  mongo:  { kind: mongo, ... }            kind: custom
  iyzico: { kind: fake, ... }             icon: puzzle
                                          run: { cmd: pnpm build --watch }
```

## The sandbox

The sandbox exists only in steps 6 and 7. Workers build and run unit tests in the
worktree; the full stack starts when the work is ready to try. It runs with the task's
box, which stays up through step 7 and ends when nobody looks.

- **Pinned commit**: `tenbox sandbox up` builds from the current commit, not the live
  worktree. QA tests, and you try, exactly the code that will merge. A new round builds a
  new sandbox.
- **Isolated per task**: one compose project per task (`tenbox-TEN-301`), its own
  databases, its own ports and `p<port>` links.
- **No internet**: an internal network plus an egress allowlist. External APIs are fakes.
- **Paused when idle**: after a while in step 7 with nobody looking, `compose stop`
  frees CPU; volumes stay.

Isolation layers, all local:

| Layer | Tool |
|---|---|
| Services | one compose project per task |
| Network | `internal: true` + egress allowlist proxy |
| Agent commands | Claude Code sandboxing (`/sandbox`, bubblewrap on Linux) |
| Later, if needed | gVisor (`runtime: runsc`) for the sandbox containers; no KVM needed |

### External APIs are faked from their docs

1. Use the provider's OpenAPI spec. If there is none, an agent writes one from the docs,
   with the source URL and date at the top.
2. Stateless APIs: Prism serves a mock straight from the spec.
3. Stateful flows (create payment, then webhook): a small Bun/Hono fake with
   `POST /__fake/scenario {"next": "card_declined"}`.
4. A fake returns only fields the docs define. It never invents fields.

### QA is a black box

A QA agent sees the task, the acceptance criteria, the OpenAPI spec and the sandbox
links. It does not read the code. It calls the API, clicks the UI with Playwright MCP if
the frontend changed, switches fake scenarios, and saves evidence: requests and
responses, screenshots, log lines, database rows. Each criterion gets its own QA agent;
a failure is re-tested by a second, independent one before it counts.

## Questions and decisions

Plan questions, plan decisions and decision cards are built (see the reference). The
target adds one step: decisions that apply to the whole project are proposed for the
project `CLAUDE.md` at close, after you approve.

## Gates

| Gate | Enforced by |
|---|---|
| Plan approved | you, between `/tenbox-plan` and `/tenbox-build` |
| Locked paths not edited | `PreToolUse` hook |
| QA does not read code | `qa` role tools + `PreToolUse` hook |
| Code is green | **GitHub CI on the PR + branch protection** |
| Result approved | you, PR approval |

The workflow's own checks and reviews make the work good. CI and branch protection make
the merge safe, because they do not depend on any agent's report.

## How you review

Start with the sandbox, then the attention list, then the QA evidence. Read the full diff
only when one of those raises a doubt.

| You want to see | Look at |
|---|---|
| Whether it works | The sandbox links, `https://p<port>.dev.example.com` |
| The risky parts | The attention list at the top of the PR body, three to five hunks with a reason |
| Proof per criterion | `.tenbox/rounds/N/qa/`, also summarised in the PR body |
| The code | The GitHub PR for `feat/TEN-301`. Your comments become feedback for the next build |
| What the agents did | `/workflows` in the task session: phases, every agent's prompt, tool calls, result. See [Watching a run](#watching-a-run) |
| Everything, by hand | `tenbox machine ssh TEN-301` while the machine is up, or the session in the Claude app |

## Subscription and limits

- Everything runs in interactive Claude Code sessions with your subscription login.
  Workflows are available on all paid plans; on Pro, turn them on in `/config`.
- Keep `autoContinueAtUsageLimit` on: a run that hits the limit waits for the reset and
  continues by itself.
- Set `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` to match the machine (start with 4 on
  4 vCPUs).
- Set `workflowSizeGuideline: medium`. Several tasks at once share one limit.

## Watching a run

Three levels, from what exists today to what comes later:

| Level | Shows | Scope | Status |
|---|---|---|---|
| `/workflows` | phases, every agent's prompt, tool calls and result; stop or restart one agent | one session | built into Claude Code |
| claude.ai/code | the same session from a phone or another machine; `needs-you` questions can be answered there | one session | built into Claude Code |
| Live pane | round, phase, agents running, questions waiting, as a pane or status line inside the task session | one session | roadmap step 7 |
| Panel | every task session on one screen | all tasks | roadmap step 8 |

### The live pane

A Claude Code mod (a plugin of function hooks, see the docs under plugins/mods) that
draws a small pane or status line in the task session, hot-reloaded while it is built. No
server, no browser. It listens to `SubagentStart`, `SubagentStop`, `PreToolUse` and
`PostToolUse`, which carry `agent_id` and `agent_type`, and it reads `.tenbox/` (part
files, `rounds/N/*.json`) for round and phase. It doubles as the test that those events
arrive for workflow agents the way the docs say they do for subagents.

### The panel

Optional, after the workflows work. Hooks post events to a small Bun server; a React +
shadcn page at `p3999` shows every task session on one screen: step, round, sandbox
links, questions waiting for you. Calm by default: it moves only when a state changes.

## Repository layout

The target adds `agents/integrator.md` and `agents/qa.md`, `hooks/` (locked-paths,
qa-no-code; `tenbox install` registers them in `~/.claude/settings.json`), `schemas/`
(the `tenbox.yaml` JSON Schema), `pane/` (the live pane plugin) and `panel/`.

## Roadmap

1. **Plan and build without a sandbox**: roles, `/tenbox-plan`, `/tenbox-build` with
   Build, Checks and Review only. `tenbox start`, `tenbox check`.
2. **PR and close**: `tenbox pr`, `/tenbox-close`, branch protection with CI. The ClickUp
   adapter and `createSubtask`.
3. **Machines**: the box image, Jobs and volumes on the cluster (Tenyard), the login sync,
   `tenbox machine run`; then resource classes, `tenbox check` as a `heavy` Job, sidecars,
   nodes that come and go.
4. **Babysitter**: the events of `data-model.md`, features and answers on the server, the
   babysitter role and skill, waves of Jobs.
5. **Manifest and sandbox**: `tenbox.yaml`, `tenbox validate`, `tenbox sandbox`, the Try
   phase with QA.
6. **Fakes from docs and OpenAPI-first**: Prism, stateful fakes, `oasdiff`, orval on the
   frontend.
7. **Live pane**: a Claude Code plugin inside the task session; settles which hook events
   workflow agents emit.
8. **Panel**.
9. **Harder isolation**: gVisor for sandbox containers.

## Open questions

- Hooks inside workflow agents: the docs say hooks run inside subagents with `agent_id`
  and `agent_type`, and workflow agents are subagents. Not yet tested for a workflow run;
  the live pane is the test.
- How strictly can the `qa` role be kept away from the code? Bash can read files, so the
  hook and Claude Code sandbox rules need testing.
- Many task sessions at once on one subscription: watch the limit before running more
  than two.
- Login refresh in a box: whether a refresh in one pod invalidates the token on your
  computer. If it does, the Secret copy has to flow both ways.
- Long checks and the idle exit: a box ends after one idle minute of its claude sessions;
  it must not end in the middle of a long `tenbox check`. Start conservative.
- `max_pr_lines`: whether tests and generated files count. Start with everything except
  lockfiles and generated clients; adjust after the first few tasks.
- Check output: `failure_pattern` and regexes today. Test runners (bun, vitest, jest,
  Gradle, Maven) can all write JUnit XML; reading that instead would drop the pattern for
  test checks, while `tsc` and lint stay text. Decide in phase 3.
