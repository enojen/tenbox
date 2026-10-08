# Tenbox

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

> **Status: design.** Nothing here is built yet. It grows out of
> [devbox](../devbox/README.md): `wtport`, `wtbase`, `heavy`, Caddy `p<port>` links and the
> `/task-start` / `/task-close` skills already exist and are reused.
> **Building starts at [Start here](#start-here-phase-1).**
>
> Visual references: [`docs/tenbox-flow.html`](docs/tenbox-flow.html) (the steps),
> [`docs/tenbox-mockup.html`](docs/tenbox-mockup.html) (a later panel),
> [`docs/tenbox-avatars.html`](docs/tenbox-avatars.html) (panel skins). They were drawn for an
> earlier multi-session design. Where they disagree with this README, the README wins.

## The idea in one picture

```
Linear task TEN-301
   │
   │  tenbox start TEN-301        worktree + branch + tmux session with one claude
   ▼
┌─ claude session "tenbox-TEN-301" (tmux, cwd = task worktree) ───────────────────────┐
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
| Resume works only in the same session (`resumeFromRunId`, longest unchanged prefix of `agent()` calls) | Keep the task session alive in tmux; a new session reruns the workflow, and agents reread `.tenbox/` so finished parts are skipped by the planner, not by the cache |
| No `Date.now()`, `Math.random()` or `new Date()` in a script (they break resume) | Timestamps come from `tenbox` command output, never from the script |

Checked against the Claude Code docs (sub-agents, workflows, worktrees, hooks, mods) on
2026-10-07: every frontmatter field and script function used in this README exists;
`pipeline` stages receive `(prevResult, item, index)`; `agentType` composes with
`schema`; hooks run inside subagents with `agent_id` and `agent_type` and can deny a tool
call (exit 2 or `permissionDecision: "deny"`); `SubagentStart` and `SubagentStop` exist.

Considered and dropped: a custom daemon with an MCP `spawn_agent` tool and one tmux
session per agent (workflows already do this, with resume), the Claude Agent SDK (API key
auth only), self-hosted E2B (needs a cluster and `/dev/kvm`).

## The steps

| # | Step | Who | Where | Output | Gate |
|---|---|---|---|---|---|
| 1 | Start | `tenbox start` | devbox shell | worktree, branch, `.tenbox/`, tmux session | |
| 2 | Plan | `/tenbox-plan` | task session | `.tenbox/plan.md`, questions | 👤 you approve |
| 3 | Build | workers | task worktree, or one worktree each | commits, `.tenbox/parts/*.md` | |
| 4 | Checks | `tenbox check` | task worktree | `.tenbox/rounds/N/checks.json` | no new failures |
| 5 | Review | reviewer panel | task worktree, read-only | `.tenbox/rounds/N/review.json`, draft PR | no must-fix |
| 6 | Try | QA agents | **sandbox**, pinned commit | `.tenbox/rounds/N/qa/` | every criterion passes |
| 7 | You | you | sandbox links, attention list, QA evidence | approve or request changes | 👤 you approve |
| 8 | Close | `/tenbox-close` | task session | merged PR, cleaned devbox, Linear Done | CI green |

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
   400). A plan that exceeds it is split into stacked PRs, `feat/TEN-301-1`,
   `feat/TEN-301-2`, one Linear sub-issue each, merged in order. You approve the split
   at the plan gate, so you never meet a 2000-line PR at the end.
2. **An attention list, not a diff.** The reviewer panel marks the hunks that need a human
   eye in `review.json` (`attention`), and `tenbox pr` puts them at the top of the PR
   body with a one-line reason. What counts as attention is a rule, not a judgement:
   migrations, auth, deletions, OpenAPI changes, files near `locked`, files not in the
   plan. Everything else is tests and plain code that the panel and CI cover.
3. **Behaviour over code.** Your gate is the sandbox and the QA evidence: try the feature,
   read the attention hunks, check that `rounds/N/qa/` shows what the criteria ask for.
   Product decisions were already taken in `decisions.md` at step 2; step 7 only asks
   "is this what I expected?".

The step-by-step page with commands: [`docs/tenbox-flow.html`](docs/tenbox-flow.html).

## Where things run

```
devbox
├ ~/tenbox/                          this repo: CLI, roles, workflows, hooks
├ ~/wt/my-app/main/             main worktree
├ ~/wt/my-app/TEN-301/          task worktree, branch feat/TEN-301
│  └ .tenbox/                        the task's shared memory (gitignored)
├ <worktrees created by isolation: 'worktree'>   parallel workers, step 3 only
├ tmux session tenbox-TEN-301        one claude, cwd = task worktree
└ docker compose -p tenbox-TEN-301   the sandbox, steps 6 and 7 only
```

All agents are normal Claude Code subagents started by the workflow inside the task
session, with your subscription login. Nothing runs in the cloud.

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

Start with two or three tasks at once. The devbox has 8 vCPUs and the sessions share one
subscription limit.

## Tracker

Tasks come from Linear today and may come from ClickUp tomorrow. Nothing in Tenbox knows
which, except one adapter in the CLI:

```ts
interface Tracker {
  getTask(id): { id, title, description, url, status }
  updateStatus(id, status: 'in_progress' | 'in_review' | 'done')
  addComment(id, text)
  createSubtask(parent, title, description): { id }
}
```

`cli/tracker/linear.ts` and `cli/tracker/clickup.ts` implement it over each REST API (the
CLI cannot use MCP). The manifest picks one:

```yaml
tracker: { kind: linear, team: TEN }          # ids look like TEN-301
tracker: { kind: clickup, list: 901234567 }   # ids look like 86abc123
```

The API key lives in `tenbox.local.yaml`. The task id is the only thing that leaks out:
branch `feat/<id>`, worktree `~/wt/<project>/<id>`, tmux `tenbox-<id>`, compose project
`tenbox-<id>`. The branch and tmux names are templates under `names:` in `tenbox.yaml`
(`branch: feat/{id}`, `tmux: tenbox-{id}` by default); the worktree path is fixed.
`tenbox start <id> --title "..."` works with no tracker at all, for trying Tenbox on a
scratch project.

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

Example:

```markdown
---
name: reviewer
description: Reviews a Tenbox task diff against its plan through one lens. Never edits.
disallowedTools: Edit, Write, NotebookEdit
model: sonnet
effort: medium
---
You review `git diff main...HEAD` against `.tenbox/plan.md` and `.tenbox/decisions.md`.
Use only the lens you are given. Report must_fix items only when the plan, the spec or
correctness requires them. Everything else is nice_to_have.
```

## Shared memory: `.tenbox/`

Agents in one run do not talk to each other. They share files in the task worktree:

```
.tenbox/
├ task.md               from Linear, written by tenbox start
├ plan.md               planner: steps, parts, acceptance criteria, spec changes
├ questions.md          open questions for you
├ decisions.md          answered questions; every agent reads this first
├ parts/01-cancel-api.md  one file per part: owner, status, files, result
└ rounds/2/
  ├ checks.json         tenbox check
  ├ review.json         merged reviewer panel result: must_fix, nice_to_have, attention
  └ qa/                 one report per criterion + evidence (requests, screenshots, logs)
```

The `attention` part of `review.json`, what goes to the top of the PR body:

```json
"attention": [
  { "file": "src/order/cancel.ts", "lines": "41-58", "why": "transaction boundary, 409 race" },
  { "file": "migrations/0012.sql", "why": "schema change, not reversible" },
  { "file": "openapi.yaml", "why": "contract change, new 409 response" }
]
```

A part file:

```markdown
# 01 · Cancel endpoint
status: done            # todo | doing | done | blocked
files: src/order/*
acceptance:
- POST /orders/{id}/cancel returns 200 and sets status=cancelled
- an already cancelled order returns 409
result: endpoint + 6 unit tests, commit 4e1f0a2
```

## The workflows: `~/tenbox/workflows/`

Linked into `~/.claude/workflows/` so they run as `/tenbox-plan`, `/tenbox-build`,
`/tenbox-close` in every project. Input comes through `args`, for example
`Run /tenbox-build on TEN-301`.

### `/tenbox-plan`

1. One planner reads the task and the code and writes `plan.md` and the part files,
   with the least code that does the task.
2. Questions it cannot settle go to `questions.md`, sorted by kind.
3. Returns the plan summary and the open questions. You answer and approve between runs.

### `/tenbox-build` (sketch)

```js
export const meta = {
  name: 'tenbox-build',
  description: 'Build, check, review and try one Tenbox task until it passes',
  phases: [{ title: 'Build' }, { title: 'Checks' }, { title: 'Review' }, { title: 'Try' }],
}

// PARTS, BUILT, CHECKS, REVIEW, PR, SANDBOX, CRITERIA, QA: JSON schemas, see schemas/
const task = args.task
const MAX_ROUNDS = args.maxRounds || 3
let feedback = args.feedback || ''
let result = { status: 'failed' }

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase('Build')
  const parts = await agent(`Task ${task}, round ${round}. Read .tenbox/plan.md and .tenbox/parts/. Feedback: ${feedback || 'none'}. Return the parts still to build.`, { agentType: 'planner', schema: PARTS })
  const parallelParts = parts.items.length > 1
  await pipeline(parts.items, p =>
    agent(`Build part ${p.id} of ${task}: ${p.goal}`, { agentType: 'worker', schema: BUILT, ...(parallelParts ? { isolation: 'worktree' } : {}) }))
  if (parallelParts) await agent(`Merge the worker branches for ${task} into feat/${task}.`, { agentType: 'integrator', schema: MERGED })

  phase('Checks')
  const checks = await agent(`Run \`tenbox check ${task} --round ${round}\` and return its JSON.`, { agentType: 'runner', schema: CHECKS })
  if (!checks.ok) { feedback = checks.summary; continue }

  phase('Review')
  const lenses = ['correctness', 'fit to plan and OpenAPI spec', 'security and data safety']
  const reviews = await parallel(lenses.map(l => () =>
    agent(`Review feat/${task} through this lens: ${l}`, { agentType: 'reviewer', schema: REVIEW, phase: 'Review' })))
  const mustFix = reviews.filter(Boolean).flatMap(r => r.must_fix)
  const attention = reviews.filter(Boolean).flatMap(r => r.attention)   // merged into rounds/N/review.json, PR body top
  await agent(`Run \`tenbox pr ${task} --draft --round ${round}\` and return its JSON.`, { agentType: 'runner', schema: PR })
  if (mustFix.length) { feedback = mustFix.join('\n'); continue }

  phase('Try')
  const sandbox = await agent(`Run \`tenbox sandbox up ${task} --profile try\` and return its JSON.`, { agentType: 'runner', schema: SANDBOX })
  const criteria = await agent(`List the acceptance criteria in .tenbox/plan.md.`, { agentType: 'planner', schema: CRITERIA })
  const tried = await pipeline(criteria.items,
    c => agent(`Test against ${sandbox.links.api}: ${c.text}`, { agentType: 'qa', schema: QA }),
    (r, c) => r.pass ? r : agent(`Independently re-test against ${sandbox.links.api}: ${c.text}`, { agentType: 'qa', schema: QA }))
  const failed = tried.filter(r => !r || !r.pass)
  if (failed.length) { feedback = failed.map(f => f ? f.finding : 'QA agent failed').join('\n'); continue }

  result = { status: 'ready-for-you', round, commit: sandbox.commit, links: sandbox.links }
  break
}
return result
```

Any agent can return `questions`. When a question is blocking, the script returns early
with `status: 'needs-you'` and the questions. You answer them, then run `/tenbox-build`
again; finished agents come back from the cache.

### `/tenbox-close`

Waits for green CI, squash-merges the PR, runs `tenbox close`, writes the Linear work-log
comment, and proposes project-wide decisions for the project `CLAUDE.md`.

## The CLI: `tenbox`

TypeScript on Bun. Deterministic work an agent should call, not reinvent. Every command
prints JSON so a `runner` agent can return it unchanged.

| Command | Does |
|---|---|
| `tenbox start <id> [--title ...]` | Worktree + branch from `main`, `.tenbox/` with `task.md` from the tracker (or `--title`), tmux session with `claude` |
| `tenbox check <TEN-xx>` | Runs the manifest checks; `wtbase` keeps only new failures; writes `checks.json` |
| `tenbox sandbox up <TEN-xx> --profile try` | Pins `HEAD`, builds from that commit, `compose up`, seeds, waits for health, prints links |
| `tenbox sandbox stop/down <TEN-xx>` | Pause (keep volumes) or remove |
| `tenbox pr <TEN-xx> [--ready]` | Refuse a dirty worktree or a branch with no commits ahead of `main`, push the branch, then create the PR (a draft; `--ready` marks it ready) or update the open one. The body holds Risks and attention and Summary from `plan.md`, then the latest round's checks summary |
| `tenbox close <TEN-xx> [--force]` | Sandbox down, worktrees and branch removed, tmux killed, `.tenbox/` archived with a `stats.json` (timeline, minutes, plan, rounds, code size, and each workflow agent with its model, seconds and tokens; numbers and labels only) |
| `tenbox ls` | All tasks: step, round, sandbox up or not, links |
| `tenbox init` | Claude Code reads the repo (lockfiles, `package.json`, compose files) and writes a draft `tenbox.yaml`; the CLI never guesses a project's tooling itself |
| `tenbox validate` | Checks `tenbox.yaml`: schema, kinds, `${...}` references, `depends_on` cycles |

Environment variables:

| Variable | Does |
|---|---|
| `TENBOX_WT_ROOT` | The worktree root; default `~/wt` |
| `WTBASE_DIR` | Where baselines are kept; default `<worktree root>/.baselines` |
| `WTBASE_PATTERN` | The failure pattern when the manifest has none |
| `CLAUDE_CONFIG_DIR` | The Claude Code config directory; default `~/.claude` |
| `TENBOX_DEBUG=1` | Logs every spawned command to stderr and prints a stack for every error, not only internal ones |

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
names: { branch: "feat/{id}", tmux: "tenbox-{id}" }   # optional; these are the defaults
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
worktree; the full stack starts when the work is ready to try. On an 8 vCPU devbox this
is what lets several tasks run at once.

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

A workflow cannot ask you anything mid-run, so questions are collected and returned:

| kind | Who answers | Example |
|---|---|---|
| `technical` | the planner, recorded in `decisions.md` | which file, which library, naming |
| `product` | **you** | business rule, what the user sees |
| `contract` | **you** | OpenAPI change, breaking change |
| `risk` | **you** | data deletion, migration, secrets, paid services |

Rules for agents: if the task does not decide it, do not guess. Blocking questions end
the run with `needs-you`. Non-blocking questions continue with a stated default that you
can overrule. Every answer goes to `decisions.md`, which every agent reads first, so
nobody asks twice. Decisions that apply to the whole project are proposed for the project
`CLAUDE.md` at close, after you approve.

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
| Everything, by hand | `code --remote ssh-remote+devbox ~/wt/my-app/TEN-301` |

## Subscription and limits

- Everything runs in interactive Claude Code sessions with your subscription login.
  Workflows are available on all paid plans; on Pro, turn them on in `/config`.
- Keep `autoContinueAtUsageLimit` on: a run that hits the limit waits for the reset and
  continues by itself.
- Set `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` low on the devbox (start with 4) and
  run browser tests through `heavy`.
- Set `workflowSizeGuideline: medium`. Several tasks at once share one limit.

## Watching a run

Three levels, from what exists today to what comes later:

| Level | Shows | Scope | Status |
|---|---|---|---|
| `/workflows` | phases, every agent's prompt, tool calls and result; stop or restart one agent | one session | built into Claude Code |
| claude.ai/code | the same session from a phone or another machine; `needs-you` questions can be answered there | one session | built into Claude Code |
| Live pane | round, phase, agents running, questions waiting, as a pane or status line inside the task session | one session | roadmap step 5 |
| Panel | every task session on one screen | all tasks | roadmap step 6 |

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
Ideas for its look are in the mockups.

## Repository layout

```
~/tenbox/
├ cli/          tenbox CLI (Bun, TypeScript); cli/tracker/ holds the Linear and ClickUp adapters
├ agents/       planner.md, worker.md, integrator.md, reviewer.md, qa.md, runner.md
├ workflows/    tenbox-plan.js, tenbox-build.js, tenbox-close.js
├ hooks/        locked-paths, qa-no-code
├ schemas/      tenbox.yaml JSON Schema, agent output schemas
├ pane/         later: the live pane plugin
├ panel/        later
└ docs/         flow page and mockups
```

`tenbox install` symlinks every file of `agents/` into `~/.claude/agents/` and of
`workflows/` into `~/.claude/workflows/`. It is idempotent and never overwrites a foreign
file. Registering the hooks in `~/.claude/settings.json` comes in a later phase.

## Roadmap

1. **Plan and build without a sandbox**: roles, `/tenbox-plan`, `/tenbox-build` with
   Build, Checks and Review only. `tenbox start`, `tenbox check`.
2. **PR and close**: `tenbox pr`, `/tenbox-close`, branch protection with CI. The ClickUp
   adapter and `createSubtask`.
3. **Manifest and sandbox**: `tenbox.yaml`, `tenbox validate`, `tenbox sandbox`, the Try
   phase with QA.
4. **Fakes from docs and OpenAPI-first**: Prism, stateful fakes, `oasdiff`, orval on the
   frontend.
5. **Live pane**: a Claude Code plugin inside the task session; settles which hook events
   workflow agents emit.
6. **Panel**.
7. **Harder isolation**: gVisor for sandbox containers.

## Start here: phase 1

Goal: run one real, small task from `my-app` through Plan, Build, Checks and Review
with workflows. No sandbox, no PR yet.

Rules for the build: TypeScript on Bun, few dependencies, no Python. Code, docs and agent
prompts in English. Developed on a Linux PC, deployed on the devbox, and it must run on
macOS and Linux from the first commit:

- Paths through `os.homedir()` and `path.join`; nothing hard-coded under `/home`.
- No shell one-liners that differ between GNU and BSD (`sed -i`, `readlink -f`,
  `timeout`, `date -d`). The CLI does that work in TypeScript and spawns only `git`,
  `tmux`, `gh`, `docker`.
- Hooks are `bun run hooks/<name>.ts`, not bash lines in `settings.json`.
- `wtbase` is re-implemented inside the CLI with the same algorithm, so the CLI does not
  depend on devbox shell tools. `wtport` follows the same way in phase 3, with the sandbox,
  so every machine gives a worktree the same port.
- Links: Caddy `p<port>` on the devbox, `http://localhost:<port>` elsewhere; the CLI picks
  by environment.
- CI runs the CLI tests on `ubuntu-latest` and `macos-latest`.
- Linux-only pieces (bubblewrap, gVisor) stay optional and devbox-only.

1. Read the current Claude Code docs for custom subagents, workflows and hooks before
   writing anything. Check every frontmatter field and limit used here against them.
2. Write `agents/planner.md`, `worker.md`, `reviewer.md`, `runner.md`.
3. Write `cli/` with `tenbox start` and `tenbox check` (JSON output, new failures only).
   `tenbox start` takes `--title` so the first runs need no tracker; the Linear adapter
   comes right after.
4. Write `workflows/tenbox-plan.js` and `workflows/tenbox-build.js` without the Try phase.
   Parts run one after another in the task worktree; parallel workers in their own
   worktrees and the `integrator` come later. Run each once, adjust, save.
5. Write `tenbox install`.

Done when:

1. `tenbox start TEN-xx` creates the worktree, `.tenbox/task.md` and a tmux session.
2. `/tenbox-plan TEN-xx` writes a `plan.md` with acceptance criteria and returns
   questions.
3. `/tenbox-build TEN-xx` builds, checks and reviews, and loops on a failure.
4. A forced review failure produces a second round with the feedback applied.
5. Stopping the run and starting it again in the same session resumes without redoing
   finished agents.

## Open questions

- `isolation: 'worktree'` (docs, answered): the worktree is `.claude/worktrees/<name>/`,
  branch `worktree-<name>`, based on `worktree.baseRef`; it is removed on its own only
  when unchanged. What happens to a worktree with commits is not stated. Two things to
  settle before phase 1 step 4: `tenbox start` must set `worktree.baseRef` to
  `feat/<id>` in the task worktree's local settings, or workers branch from `main`; and
  the `integrator` must merge the `worktree-*` branches into `feat/<id>`, then run
  `git worktree remove` and delete the branches, since nothing else will.
- Hooks inside workflow agents: the docs say hooks run inside subagents with `agent_id`
  and `agent_type`, and workflow agents are subagents. Not yet tested for a workflow run;
  the live pane is the test.
- How strictly can the `qa` role be kept away from the code? Bash can read files, so the
  hook and Claude Code sandbox rules need testing.
- Many task sessions at once on one subscription: watch the limit before running more
  than two.
- `gh` login on the devbox is expired; renew it before phase 2.
- Stacked PRs: how `tenbox pr` sets the base branch, how CI runs on each PR, and how
  `/tenbox-close` merges them in order and rebases the rest. Decide before phase 2.
- `max_pr_lines`: whether tests and generated files count. Start with everything except
  lockfiles and generated clients; adjust after the first few tasks.
- Check output: `failure_pattern` and regexes today. Test runners (bun, vitest, jest,
  Gradle, Maven) can all write JUnit XML; reading that instead would drop the pattern for
  test checks, while `tsc` and lint stay text. Decide in phase 3.
