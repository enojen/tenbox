# Data model (draft)

A planning draft, not built yet. It records what we decided so far, top down. Open
questions are marked **Open**. Today's code is in `docs/hierarchy.md`; the target design is
`docs/design.md`.

## Decided

### Server

Tenbox gets a server. It owns the records: the organization, its users, its projects and
their tasks. The CLI on each machine talks to it. See "Server and machine" below.

For now the server runs locally, on the developer's machine, and listens on `localhost`
only. It moves to a real host later.

**Talking to it.** The CLI calls the server's HTTP API with JSON (e.g. `POST /events`).
Claude gets no MCP server now: Claude never sends records, the CLI does, so writing stays
free of model decisions and tokens. A read-only MCP server on top of the same HTTP API can
come later, when something needs to ask the server from a chat (e.g. "how many tasks took
3 rounds last week?").

**Login.** Claude Code does not need to know who the user is: Claude always calls `tenbox`,
and the CLI carries the identity.

```
1. on the server (by hand):  tenbox-server user add --name Enes --github enojen
                             → prints a token, tbx_...
2. on the machine:           tenbox login --server http://localhost:4300 --token tbx_...
3. the CLI writes            ~/.tenbox/auth.json (readable by the user only)
4. every request sends       Authorization: Bearer tbx_...
```

- Users are added by hand for now. A sign-up page comes with the panel and gives tokens
  the same way.
- The token is a Tenbox credential and stays on the machine only. The rule "credentials
  are never stored" is about the GitHub and Claude Code logins.
- No GitHub check at login for now (kept simple).

**Code layout.** The server lives in this repo. Both apps share only `domain/`; each has
its own layers, in the same shape: presentation → application → infra, with domain under
all of them.

```
domain/               shared, pure: ids, events, manifest schema, failure lines
cli/
  main.ts  args.ts
  commands/           presentation: arguments → use case → JSON
  application/        projects, worktrees, tasks, events, syncs...
  infra/              git, tmux, gh, files, claudeSessions, the server client
server/
  main.ts
  routes/             presentation: HTTP request → use case → JSON
  application/        events, users, projects, task numbers
  infra/              sqlite, tokens
```

- `cli/` and `server/` never import each other; both import `domain/`.
- Inside each app the layer rule of today holds: `infra/` imports only `domain/`,
  `application/` imports both.
- A test checks these import rules.
- Not a shared `lib/application` and `lib/infra`: the two apps share no use case and no
  infra (git, tmux and Claude files on one side, sqlite on the other), and the server must
  not carry machine code when it moves to a real host.

### Organization

The top of the hierarchy, e.g. "Acme Studio".

```
Organization
 ├ users[]
 └ projects[]
     └ tasks[]
         └ parts, rounds, checks, proofs, stats
```

### User

```
User
 ├ id        6 random characters, e.g. u-4k2m7a
 ├ name
 ├ email
 └ github    login name only, e.g. enojen
```

- One user can be in many organizations. The type (`admin` | `member`) belongs to the
  membership, so a user can be an admin in one organization and a member in another.
- The Claude Code login is not stored: it belongs to the machine, not to the user. Tenbox
  checks it on the machine at each command.
- An organization id has the same form, e.g. `o-x2k9pq`. A project belongs to one
  organization.

| Type | Can do |
|---|---|
| `admin` | add and remove users and projects |
| `member` | start, run and close tasks |

**Credentials are never stored**, not in a file, not in a database, not on the server.
Each user logs in on their own machine (`gh auth login`, Claude Code login). Tenbox calls
`gh` and `claude`, which use those logins. Tenbox only checks them, e.g. `gh auth status`
gives the GitHub login, which Tenbox matches to the user. How to check the Claude Code login
must be verified in the current Claude Code docs.

### Project

```
Project
 ├ id        6 characters, a-z and 0-9, random, e.g. k7f3qa
 ├ name      can change; the id does not
 └ repo      e.g. github.com/enojen/tenbox
```

The id is written once into `tenbox.yaml` (`id: k7f3qa`) and committed. `tenbox start`
writes it when it is missing and asks on stderr to commit it.

### Directories follow the ids

The path is the id. Task state lives outside the git worktree, in a tree of ids:

```
~/.tenbox/
└ k7f3qa/                 project      id: k7f3qa
  ├ project.json          { id, name }: ls shows only ids
  └ TEN-301/              task         id: k7f3qa/TEN-301
    ├ task.md
    ├ plan.md
    ├ parts/03-login.md   part         id: k7f3qa/TEN-301/p03
    ├ rounds/2/           round        id: k7f3qa/TEN-301/r2
    │  └ checks.json      check "unit" id: k7f3qa/TEN-301/r2/unit
    ├ proofs.json
    ├ approved.json       written by tenbox approve
```

```
~/wt/tenbox/TEN-301/          code only (the git worktree)
  └ .tenbox  →  ~/.tenbox/k7f3qa/TEN-301/   (symlink)
```

- Only the project id is random. Every id below it is the path under the project, so
  agents never make ids.
- A part file keeps its name, `03-login.md`: the id comes from `03`, the rest is for people.
- A proof has no id of its own: it belongs to one part and one test name.
- Agents keep writing `.tenbox/` in the worktree; the symlink sends it to the task dir.
- A renamed project moves nothing: the directory name is the id.
- **No archive.** `tenbox close` removes the worktree; the task dir stays where it is and
  the task record on the server becomes `closed`. `~/wt/.archive/` goes away.

### Server and machine

The server owns the records. The machine holds only the working files.

| Data | Where | Why |
|---|---|---|
| Organization, users, projects | server | everyone sees the same list |
| Task record (id, user, state) | server | everyone sees who works on what |
| Events: rounds, proofs, agents, close | server, sent as the task moves | team reports |
| Code (worktree) | machine | git carries it |
| Task dir (plan, parts, rounds files) | machine only | agents write files; never sent |
| Credentials | machine only | never stored |

- **The server is the source of truth for records.** Tenbox sends a record at each step
  of a task, e.g. task started, round finished, task closed with its stats.
- **The task dir never goes to the server.** Agents write it as their work area. The plan
  already reaches GitHub in the PR body (`tenbox pr`).
- **No offline mode, but work goes on.** Claude Code needs the internet too. When the server
  cannot be reached, the command says so at once (stderr and its JSON) and does its own
  work anyway. The events not sent go out with the next sync (event ids make resending
  safe). At worst one task's records stay incomplete; that is accepted.
- **No local database.** The server database replaces the local index (`tenbox index`).
- **Task state** (`open` / `closed`) is a field of the task record on the server.
- **No local `stats.json`.** The server computes the numbers from the events.
- **Nothing reads the server yet.** The panel (a later step) will be the first reader.
- **Who sees what:** an organization admin sees every task of the organization; a member
  sees their own tasks.
- **Old data** (`~/wt/.archive/*/stats.json`) is moved by hand later. Open worktrees of the
  old layout are not migrated.

Server tables (first draft):

```sql
organizations (id PK, name)
users         (id PK, name, email, github)
memberships   (org_id FK, user_id FK, type)   -- type: admin | member
projects      (id PK, org_id FK, name, repo)
tasks         (id PK, project_id FK, user_id FK, task, title, state,
               rounds, code_added, code_removed, code_files, test_added,
               min_plan, min_wait_approval, min_build, min_human_review,
               min_total)                     -- state: open | closed
parts         (id PK, task_id FK, nn, difficulty, points)
rounds        (id PK, task_id FK, n, ok)
checks        (id PK, round_id FK, name, exit_code, duration_ms,
               failures, new_failures, fixed)  -- counts only
proofs        (part_id FK, file, test, failure, source)
                                              -- source: worker | manual
events        (id PK, type, subject_id, user_id FK, tenbox, at, body)
```

- `tasks.user_id` is the user who ran `tenbox start`. Assigning work stays in the tracker.
- `events` keeps every event as it came (`body` is the JSON). The other tables are built
  from the events.
- The server computes the numbers today's `stats.json` holds and writes them to the
  tables, even while nothing reads them: points per part (+1 per distinct proof test, -1
  per unproven item), durations per task (from the events' `at`), rounds and code lines.

## CLI

`application/` stays in `cli/`; the server has its own use cases in `server/`. Only
`domain/` is shared.

The CLI does three jobs:

1. **Set up the work area on the machine:** worktree, task dir, symlink, setup, tmux.
2. **Do work on the machine:** run checks, open the PR, record proofs.
3. **Tell the server:** its own events, and sync.

### Modules

| Module | State | Note |
|---|---|---|
| `projects`, `manifests` | stays | the manifest gets `id` |
| `worktrees` | stays | code only now; adds the `.tenbox` symlink |
| `tasks` | changes | the task dir moves to `~/.tenbox/<project id>/<task id>/` |
| `setups`, `sessions`, `baselines` | stays | |
| `proofs` | stays | also sends `proof.added` |
| `parts` | goes | only stats read it; plan numbers come from the journal |
| `stats` | goes | the server computes the numbers |
| `events` | new | builds events and sends them |
| `syncs` | new | builds events from Claude Code's workflow files |
| `logins` | new | writes and reads `~/.tenbox/auth.json` |
| `infra/server.ts` | new | the server's HTTP API, on top of `infra/http.ts` |

### Commands

```
start    sync → manifest (id) → task from the tracker
         → task dir (~/.tenbox/<pid>/<tid>)
         → worktree + .tenbox symlink
         → setup → tmux → task.started

approve  sync → plan.md exists? → write approved.json
         → plan.approved

check    sync → run the checks → rounds/N/checks.json
         → round.checked

proof    sync → proofs.json → proof.added

pr       sync → push → gh pr → pr.saved

close    sync → safety checks → kill tmux
         → remove worktree + branch (the task dir stays)
         → gh pr view → pr.merged → task.closed
         → tracker: done

login    write the token → one test request to the server
```

### Approval

The approval is kept on the machine too, so a build can check it when the server cannot be
reached: `tenbox approve` writes `approved.json` in the task dir. The first step of
`/tenbox-build` runs, through the runner, a `tenbox` command that fails without
`approved.json`; the build stops there. A rule is checked by code, not left to a model.

### Files the CLI reads

With stats gone, the CLI reads little of the task dir: `plan.md` (`pr` puts it in the PR
body, `approve` checks it exists) and the `rounds/` names (`check` finds the next round).
Everything else is the agents' work area: they write and read it. The fewer agent files
the CLI parses, the more freely their format can change.

## Events

The CLI sends one event at each step of a task. Every event has `id`, `schema` (the event format version, a number), `event`, the id it is
about, `user`, `tenbox` (the commit sha of the Tenbox that sent it), `at` and `sent_at`.
Below, those common fields are left out after the first event.

- `id` is fixed for one event, e.g. `wf_7359/a9703d/round.reviewed`. The server skips an
  event whose `id` it already has, so sending twice is safe and the machine keeps no "sent"
  list.
- `at` is when it happened; `sent_at` is when it was sent.
- `schema` changes when an event's format changes, so the server can still read old events.

### Rules

- **Counts, not text.** Failure lines are sent as counts, not as text: they can hold
  file paths and code. Without the text, "most failing tests" and "flaky tests" are not
  possible; if we add the text later, it starts with new tasks only, because the task dir
  never goes to the server.
- **Start and end.** Steps that take time send a `started` and an end event, so the server
  can draw durations.
- **Sent as the task moves**, not all at close.
- **No money.** Claude Code's session files have no dollar amounts; only tokens are sent.

### Who sends

Workflows send nothing and do not change. CLI commands send their own events. Every
other event is built by **sync** from the files Claude Code writes for each workflow run:

- `workflows/wf_*.json`: each agent's label (e.g. `round 2: base`), start time, duration,
  tokens; the run's `args` and result.
- `subagents/workflows/wf_*/journal.jsonl`: each agent's full result, in its schema (the
  planner's parts, each reviewer's must_fix and unproven, each worker's proofs).

**Sync**: every `tenbox` command first reads these files and sends the events not sent
yet. During a build, `tenbox check` runs every round, so events go out almost live. No
runner agent is spent on sending, and times are exact (a workflow script cannot read the
clock).

| Event | Sent by | From |
|---|---|---|
| `task.started` | `tenbox start` | itself |
| `plan.approved` | `tenbox approve` | itself |
| `round.checked` | `tenbox check` | itself |
| `proof.added` (manual) | `tenbox proof` | itself |
| `pr.saved` | `tenbox pr` | itself |
| `task.closed` | `tenbox close` | itself |
| `pr.merged` | `tenbox close` | `gh pr view`: GitHub's merge time |
| `plan.started`, `plan.done` | sync | the plan run |
| `build.started`, `build.done` | sync | the build run |
| `round.started` | sync | the start of the round's first agent |
| `round.reviewed` | sync | reviewer results (journal) |
| `proof.added` (worker) | sync | worker results (journal) |
| `feedback.sent` | sync | `auto`: must_fix; `human`: the run's `args` |
| `workflow.done` | sync | agent numbers |

Risks:

- These files are Claude Code's internal format, not a public API. Today's `stats` code
  takes the same risk (`infra/claudeSessions.ts`); a format change touches only that file.
- **Checked (TEN-349, Claude Code 2.1.295):** watched three plan runs and two build runs
  while they ran.
  - `journal.jsonl` is written live. A `launched` line comes at the start, then one
    `started` line (`key`, `agentId`, `label`, `phase`) when an agent starts, and one
    `result` line (`key`, `agentId`, `result`) when it ends. The lines have no time.
  - `workflows/wf_*.json` is written once, when the run ends, in the same second as the
    last journal line. It has the run's `startTime`, `durationMs` and `status`, and per
    agent in `workflowProgress` the `label`, `agentType`, `model`, `startedAt`,
    `durationMs`, `tokens` and `toolCalls`.
  - Each agent also has `agent-<id>.meta.json` (written when it starts: `agentType`,
    `description`, the label) and its transcript `agent-<id>.jsonl` (written live, every
    line has a `timestamp`).
  - So sync can send `round.reviewed` and worker `proof.added` live, from the journal. A
    live time comes from the agent's transcript: its first line for the start, the line
    of its result for the end. `workflow.done`, `build.done` and the agent numbers
    (tokens, tool calls) go out when the run ends.

### task.started (`tenbox start`)

```json
{
  "event": "task.started",
  "task": "k7f3qa/TEN-301",
  "project": "k7f3qa",
  "user": "u-4k2m7a",
  "tenbox": "9d90eeb",
  "title": "Add login",
  "tracker": "linear",
  "url": "https://linear.app/...",
  "branch": "feat/TEN-301",
  "base": { "ref": "main", "sha": "9d90eeb" },
  "at": "2026-10-08T10:00:00Z"
}
```

### plan.started, plan.done (`/tenbox-plan`)

```json
{ "event": "plan.started", "task": "k7f3qa/TEN-301", "deep": false }
```

```json
{
  "event": "plan.done",
  "task": "k7f3qa/TEN-301",
  "plan_sha": "3f9c…",
  "estimated_lines": 300,
  "parts": [
    { "id": "p01", "difficulty": "easy" },
    { "id": "p02", "difficulty": "hard" }
  ],
  "criteria": 4,
  "questions": { "total": 2, "blocking": 1 },
  "lenses": ["security"]
}
```

The plan text is not sent; it reaches GitHub in the PR body. `plan_sha` is the SHA-256 of
`plan.md` in hex. A plan run again gives one more `plan.done`; a plan changed by hand
before approval shows as a `plan.approved` with a different `plan_sha`.

### plan.approved (`tenbox approve`)

```json
{ "event": "plan.approved", "task": "k7f3qa/TEN-301", "plan_sha": "7b21…" }
```

The user runs `tenbox approve <id>` after reading the plan. Today this moment is not
recorded and `wait_approval` is a guess; this event makes it exact. `/tenbox-build` refuses to start before the plan is approved.

### build.started, build.done (`/tenbox-build`)

```json
{ "event": "build.started", "task": "k7f3qa/TEN-301", "max_rounds": 3 }
```

```json
{
  "event": "build.done",
  "task": "k7f3qa/TEN-301",
  "status": "ready",
  "rounds": 2
}
```

`status`: `ready` | `failed` | `needs-you`.

### feedback.sent

```json
{
  "event": "feedback.sent",
  "task": "k7f3qa/TEN-301",
  "round": "k7f3qa/TEN-301/r3",
  "from": "human",
  "must_fix": 1
}
```

`from`: `auto` (a failed round passes it to the next) | `human` (a build started with
`feedback`).

### round.started, round.checked, round.reviewed

```json
{ "event": "round.started", "round": "k7f3qa/TEN-301/r2" }
```

```json
{
  "event": "round.checked",
  "round": "k7f3qa/TEN-301/r2",
  "commit": "a1b2c3d",
  "ok": false,
  "checks": [
    {
      "id": "r2/unit",
      "exit_code": 1,
      "duration_ms": 8400,
      "timed_out": false,
      "failures": 3,
      "new_failures": 1,
      "fixed": 0,
      "baseline": { "sha": "9d90eeb", "source": "exact" }
    }
  ]
}
```

```json
{
  "event": "round.reviewed",
  "round": "k7f3qa/TEN-301/r2",
  "must_fix": 1,
  "nice_to_have": 3,
  "attention": 2,
  "unproven": [{ "part": "p02", "reason": "..." }]
}
```

Build, check and review times inside a round come from the `at` of these events and of the
round's agents.

### proof.added

```json
{
  "event": "proof.added",
  "part": "k7f3qa/TEN-301/p01",
  "file": "domain/login.test.ts",
  "test": "rejects an empty password",
  "failure": "expected 400, got 200",
  "source": "worker"
}
```

`source`: `worker` (from a build run) | `manual` (`tenbox proof`).

### workflow.done

```json
{
  "event": "workflow.done",
  "task": "k7f3qa/TEN-301",
  "workflow": "tenbox-build",
  "run": "wf_...",
  "agents": [
    {
      "role": "worker",
      "label": "p01",
      "round": 2,
      "model": "claude-sonnet-5-5",
      "started": "...",
      "seconds": 310,
      "tokens": 48000,
      "tool_calls": 62
    }
  ]
}
```

### pr.saved, pr.merged

```json
{
  "event": "pr.saved",
  "task": "k7f3qa/TEN-301",
  "number": 12,
  "url": "https://github.com/.../pull/12",
  "state": "created",
  "draft": true
}
```

```json
{ "event": "pr.merged", "task": "k7f3qa/TEN-301", "number": 12 }
```

### task.closed (`tenbox close`)

```json
{
  "event": "task.closed",
  "task": "k7f3qa/TEN-301",
  "forced": false,
  "code": { "added": 420, "removed": 80, "files": 9, "test_added": 150 }
}
```

Today's `stats.json` goes away: its numbers come from the earlier events. Close sends only
what is left: the code lines.

### Charts these events give

- Where a task's time goes: plan, wait for approval, build, human review, merge.
- How many rounds a task needs, and how often a build needs a human.
- Average time and rounds per Tenbox version (did a prompt change help?).
- Estimated difficulty against real time.
- Speed and tokens per model.

## Order of work

The current roadmap (`/tenbox-close`, TEN-325) stops until this model is built; it goes on
after.

## Open

- Nothing open now. Next: turn this draft into Linear tasks.
