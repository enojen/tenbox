# Data model (target)

What is not built yet of the server's data model: the login from the CLI, the task records
and the events. The server, its organizations, users, memberships and projects and the task
dir `~/.tenbox/<project id>/<task id>` are built; see the [reference](reference.md). The
rest of the target design is in [`design.md`](design.md).

## Login

Claude Code does not need to know who the user is: Claude always calls `tenbox`, and the CLI
carries the identity.

```
1. on the server (by hand):  tenbox-server user add ...  → prints a token, tbx_...
2. on the machine:           tenbox login --server http://localhost:4300 --token tbx_...
3. the CLI writes            ~/.tenbox/auth.json (readable by the user only)
4. every request sends       Authorization: Bearer tbx_...
```

- The token is a Tenbox credential and stays on the machine only. The GitHub and Claude
  Code logins are never stored: Tenbox calls `gh` and `claude`, which use them, and only
  checks them (`gh auth status` gives the GitHub login, matched to the user).
- No GitHub check at login for now. A sign-up page comes with the panel.
- Claude gets no MCP server now: Claude never sends records, the CLI does. A read-only MCP
  server on top of the HTTP API can come later.

## Server and machine

The server owns the records. The machine holds only the working files.

| Data | Where | Why |
|---|---|---|
| Organization, users, projects | server | everyone sees the same list |
| Task record (id, user, state) | server | everyone sees who works on what |
| Events: rounds, proofs, agents, close | server, sent as the task moves | team reports |
| Code (worktree) | machine | git carries it |
| Task dir (plan, parts, rounds files) | machine only | agents write files; never sent |
| Credentials | machine only | never stored |

- **The server is the source of truth for records.** The plan reaches GitHub in the PR
  body, not the server.
- **No offline mode, but work goes on.** When the server cannot be reached, the command says
  so (stderr and its JSON) and does its own work anyway. Unsent events go out with the next
  sync; event ids make resending safe.
- **No local `stats.json` and no local index** once the server computes the numbers from
  the events.
- **Who sees what:** an organization admin sees every task of the organization; a member
  sees their own tasks.

Server tables still to build:

```sql
tasks         (id PK, project_id FK, user_id FK, task, title, state,
               rounds, code_added, code_removed, code_files, test_added,
               min_plan, min_wait_approval, min_build, min_human_review,
               min_total)                     -- state: open | closed
parts         (id PK, task_id FK, nn, difficulty, points)
rounds        (id PK, task_id FK, n, ok)
checks        (id PK, round_id FK, name, exit_code, duration_ms,
               failures, new_failures, fixed)  -- counts only
proofs        (part_id FK, file, test, failure, source)  -- source: worker | manual
events        (id PK, type, subject_id, user_id FK, tenbox, at, body)
```

- `tasks.user_id` is the user who ran `tenbox start`. Assigning work stays in the tracker.
- `events` keeps every event as it came (`body` is the JSON). The other tables are built
  from the events, even while nothing reads them: points per part, durations per task (from
  the events' `at`), rounds and code lines.

## Events

The CLI sends one event at each step of a task. The schema of every event is in
`domain/events.ts`. Every event has `id`, `schema` (the format version), `event`, the id it
is about, `user`, `tenbox` (the commit sha of the Tenbox that sent it), `at` and `sent_at`.

- `id` is fixed for one event, e.g. `wf_7359/a9703d/round.reviewed`. The server skips an
  event whose `id` it already has, so the machine keeps no "sent" list.
- Ids below the project are paths: task `k7f3qa/TEN-301`, part `k7f3qa/TEN-301/p03`, round
  `k7f3qa/TEN-301/r2`, check `k7f3qa/TEN-301/r2/unit`. Agents never make ids.

### Rules

- **Counts, not text.** Failure lines are sent as counts: they can hold file paths and
  code.
- **Start and end.** Steps that take time send a `started` and an end event.
- **Sent as the task moves**, not all at close.
- **No money.** Claude Code's session files have no dollar amounts; only tokens are sent.

### Who sends

Workflows send nothing. CLI commands send their own events. Every other event is built by
**sync** from the files Claude Code writes for each workflow run: every `tenbox` command
first reads them and sends the events not sent yet. During a build `tenbox check` runs every
round, so events go out almost live, and times are exact (a workflow script cannot read the
clock).

| Event | Sent by | From |
|---|---|---|
| `task.started` | `tenbox start` | itself |
| `plan.approved` | `tenbox approve` | itself; its `plan_sha` against `plan.done` shows a plan changed by hand |
| `round.checked` | `tenbox check` | itself |
| `proof.added` (manual) | `tenbox proof` | itself |
| `pr.saved` | `tenbox pr` | itself |
| `task.closed` | `tenbox close` | itself: the code lines |
| `pr.merged` | `tenbox close` | `gh pr view`: GitHub's merge time |
| `plan.started`, `plan.done` | sync | the plan run |
| `build.started`, `build.done` | sync | the build run |
| `round.started` | sync | the start of the round's first agent |
| `round.reviewed` | sync | reviewer results (journal) |
| `proof.added` (worker) | sync | worker results (journal) |
| `feedback.sent` | sync | `auto`: must_fix; `human`: the run's `args` |
| `workflow.done` | sync | agent numbers |

**The files sync reads** are Claude Code's internal format, not a public API; a format
change touches only `cli/infra/claude/`. Checked in TEN-349 (Claude Code 2.1.295) on three
plan runs and two build runs:

- `subagents/workflows/wf_*/journal.jsonl` is written live: a `launched` line, then per
  agent one `started` line (`key`, `agentId`, `label`, `phase`) and one `result` line. The
  lines have no time.
- `workflows/wf_*.json` is written once, when the run ends. It has the run's `startTime`,
  `durationMs` and `status`, and per agent the `label`, `agentType`, `model`, `startedAt`,
  `durationMs`, `tokens` and `toolCalls`.
- Each agent's transcript `agent-<id>.jsonl` is written live, with a `timestamp` per line.
- So `round.reviewed` and worker `proof.added` can go out live, with their time from the
  transcript. `workflow.done`, `build.done` and the token numbers go out when the run ends.

### Charts these events give

- Where a task's time goes: plan, wait for approval, build, human review, merge.
- How many rounds a task needs, and how often a build needs a human.
- Average time and rounds per Tenbox version (did a prompt change help?).
- Estimated difficulty against real time.
- Speed and tokens per model.
