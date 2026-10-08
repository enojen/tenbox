# Tenbox

Tenbox runs one tracker task through plan, build, check, review and merge with Claude Code
workflows and custom subagents. It is a thin layer: Claude Code does the agents and the
orchestration; Tenbox adds the roles, two workflows, a task layout on disk and a small CLI
for the steps an agent should not improvise.

This README describes what is built and how it runs today. Every statement here must be
true of the code. The target design (sandbox, QA, parallel workers, the panel) is in
[`docs/design.md`](docs/design.md); it describes later phases, not today's behaviour.

**Status**: phase 1 is done; phase 2 has `tenbox close` and `tenbox pr`. See
[Roadmap](#roadmap).

## How a task runs today

```
tenbox start TEN-301              worktree ~/wt/<project>/TEN-301, branch feat/TEN-301, .tenbox/task.md
  /tenbox-plan TEN-301            planner writes plan.md, parts, questions.md     👤 you approve
  /tenbox-build TEN-301           rounds of build → tenbox check → review
  review the diff by hand
tenbox pr TEN-301 [--ready]       push the branch, create or update the PR
  merge on GitHub (squash)        👤 you merge
git pull                          in the main checkout
tenbox close TEN-301              archive .tenbox/ with stats.json, remove worktree and branch
```

Run `/tenbox-plan` and `/tenbox-build` in an interactive `claude` session in the task
worktree (`tenbox start` opens one in tmux). A headless `claude -p` run stops at the
workflow approval. To send review feedback into a new build:
`/tenbox-build { "task": "TEN-301", "feedback": "..." }`.

## The CLI: `tenbox`

TypeScript on Bun. Every command prints one JSON document on stdout; human text goes to
stderr. A failure prints `{ "ok": false, "error", "code" }` and exits 1, or 2 for a usage
error. `TENBOX_DEBUG=1` logs every spawned command and prints stacks.

| Command | Does |
|---|---|
| `tenbox start <id> [--title "..."] [--base <branch>] [--no-setup] [--no-tmux]` | Task worktree and branch from the base, `.tenbox/` with `task.md` from the tracker (or from `--title`), the manifest `setup` command, tracker status to in progress, a tmux session with `claude`. Sets `worktree.baseRef: head` in the main checkout's `.claude/settings.local.json`. Safe to run twice |
| `tenbox check <id> [--round N] [--base <branch>] [--timeout 600]` | Runs every manifest check in the task worktree and keeps only new failures (see below). Writes `.tenbox/rounds/N/checks.json` and `checks/<name>.log`; without `--round` it takes the next free round |
| `tenbox pr <id> [--ready]` | Refuses a dirty worktree or a branch with no commits ahead of the base. Pushes the branch to `origin`, then creates the PR (a draft unless `--ready`) or updates the open one. The body holds the latest round's checks summary, then the whole `plan.md` folded |
| `tenbox close <id> [--force]` | Refuses a dirty worktree or a branch not merged into the base (`--force` skips both) and an existing archive. Moves `.tenbox/` to the archive with a `stats.json`, kills the tmux session, removes the worktree and the local branch, sets the tracker to done. A step with nothing to do is skipped |
| `tenbox install` | Symlinks every file of `agents/` and `workflows/` into `~/.claude/`. Never overwrites a foreign file |

The base is the manifest `base`, `main` by default; `--base` overrides it for `start` and
`check`. Task ids are letters, digits, `_` and `-`.

**New failures only.** A check fails only on failure lines that the base commit does not
already have. The failure lines of the base (the baseline) are kept per project, check and
commit under `~/wt/.baselines/`. `tenbox check` uses the baseline of the base commit, else
the newest one it has. With none at all, it runs the check once in the main checkout when
that sits at the base commit, and saves the result. Without any baseline, every failure
line is new.

**`stats.json`** (in the archive): timeline, minutes per step (plan, wait for approval,
build, human review), plan difficulty and estimated lines, rounds, review counts, code
lines, and each workflow agent with its model, seconds and tokens. Numbers and labels only.

| Variable | Does |
|---|---|
| `TENBOX_WT_ROOT` | The worktree root; default `~/wt` |
| `WTBASE_DIR` | Where baselines are kept; default `<worktree root>/.baselines` |
| `WTBASE_PATTERN` | The failure pattern when the manifest has none |
| `CLAUDE_CONFIG_DIR` | Where `tenbox install` links to; default `~/.claude` |
| `LINEAR_API_KEY` | The Linear key when the manifest has no `tracker.api_key` |
| `TENBOX_DEBUG` | `1` logs spawned commands and prints stacks |

## The workflows: `workflows/`

Plain JavaScript Claude Code workflows, linked by `tenbox install`.

**`/tenbox-plan <id>`**, or `{ task, deep: true }` to run the planner on the strongest
model. One planner reads the task and the code and writes `.tenbox/plan.md`, one part file
per part and `questions.md`. It returns the summary, parts, acceptance criteria, the extra
review lenses and the questions.

**`/tenbox-build <id>`**, or `{ task, feedback, maxRounds }` (default 3 rounds). Each round:

1. **Build**: the planner lists the parts still to build and the extra lenses; one worker
   per part, one after another, in the task worktree. A part marked `hard` gets the strong
   model. A blocked worker ends the run with `needs-you` and its questions.
2. **Checks**: a runner runs `tenbox check <id>`. New failures become the next round's
   feedback.
3. **Review**: the `base` lens always runs; `security` and `contract` run when the plan
   asks for them. Any `must_fix` item becomes the next round's feedback.

It returns `ready-for-you` with the attention and nice-to-have lists, `needs-you`, or
`failed` with the last feedback after the last round.

## Roles: `agents/`

| Role | Model | Does |
|---|---|---|
| planner | opus | Writes the plan, the parts and the questions; writes only under `.tenbox/` |
| worker | sonnet | Builds one part with its tests, proves each change of behaviour with a test that fails first, runs the checks, commits, fills the part file |
| reviewer | sonnet | Reviews the diff through one lens; returns `must_fix`, `nice_to_have`, `attention`; never edits |
| runner | sonnet | Runs one `tenbox` command and returns its JSON unchanged |

## Task files: `.tenbox/`

Inside the task worktree, excluded from git:

```
.tenbox/
├ task.md          tenbox start: id, title, status, tracker, url, description
├ plan.md          planner: summary, approach, parts, acceptance criteria, risks, size
├ questions.md     planner: open questions by kind (product, technical, contract, risk)
├ decisions.md     you: answered questions; every agent reads it first
├ parts/01-x.md    one per part: status, difficulty, files, acceptance, result
└ rounds/N/
  ├ checks.json    tenbox check
  └ checks/*.log   the output of each check
```

`tenbox close` moves the folder to `~/wt/.archive/<project>/<id>/` and adds `stats.json`.

## The manifest: `tenbox.yaml`

```yaml
project: tenbox                  # optional; default: the main checkout's directory name, or its parent's when it is `main`
base: main                       # optional: the branch tasks start from and merge into
setup: bun install               # optional: runs in a new task worktree
checks:                          # name: command; tenbox check runs them all
  types: bunx tsc --noEmit
  unit: bun test cli
failure_pattern: "..."           # optional: a regex for a failure line; the default knows bun, vitest, jest and tsc
tracker: { kind: linear }        # none (default) or linear; api_key here or LINEAR_API_KEY
names: { branch: "feat/{id}", tmux: "tenbox-{id}" }   # optional; these are the defaults
```

Layers, later ones win: `tenbox.yaml` (task worktree, else main checkout), then
`tenbox.local.yaml` in the main checkout, then in the task worktree, then
`.tenbox/override.yaml`. Keys of later phases are dropped without an error.

## Tracker

`none`: the task comes from `tenbox start --title`, and status changes are skipped.
`linear`: `tenbox start` reads the issue over Linear's GraphQL API and sets it to in
progress; `tenbox close` sets it to done.

## Repository layout

```
cli/          the tenbox CLI; entry cli/main.ts (layers: see CLAUDE.md)
  domain/       pure code: ids, failure lines, manifest schema, stats, the Tracker port
  application/  use cases; commands/ has one file per CLI command
  infra/        git, gh, tmux, shell, files, env, baselines on disk, tracker/ adapters
  test/         temporary projects and the CLI runner for tests
agents/       planner.md, worker.md, reviewer.md, runner.md
workflows/    tenbox-plan.js, tenbox-build.js
docs/         design.md (the target design), flow page and mockups
```

CI (`.github/workflows/ci.yml`) runs the typecheck and the tests on Ubuntu and macOS.

## Roadmap

1. **Done**: roles, `/tenbox-plan`, `/tenbox-build` with Build, Checks and Review,
   `tenbox start`, `check`, `install`.
2. **Now**: `tenbox close` and `tenbox pr` are built. Next: `/tenbox-close` (after you
   merge: pull, close, delete the remote branch), the ClickUp adapter.
3. Later, see [`docs/design.md`](docs/design.md): the full manifest and the sandbox, the
   Try phase with QA, fakes from API docs, the live pane, the panel.
