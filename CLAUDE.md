# CLAUDE.md

Tenbox: a thin layer on top of Claude Code that runs one tracker task through plan,
build, check, review, try and merge with workflows and custom subagents. Read
`README.md` first: it describes what is built today, and every statement in it must be true
of the code. Where code and README disagree, fix one of them in the same change.
`docs/design.md` is the target design for later phases; it is not today's behaviour, so
never change it to match the code. When a task builds a piece of it, describe that piece in
the README.

## Status

Phase 1 is done: roles, `/tenbox-plan`, `/tenbox-build` without the Try phase,
`tenbox start`, `check`, `install`, the Linear tracker. Phase 2 has `tenbox close` (the
cleanup only, no sandbox and no merge) and `tenbox pr` (push, then create or update the PR
with `gh`); next is `/tenbox-close`. No sandbox yet.

## Rules

- TypeScript on Bun, few dependencies, no Python. Code, docs and agent prompts in English.
- Must run on macOS and Linux from the first commit: `os.homedir()` and `path.join`, no
  GNU-only or BSD-only shell flags, hooks as `bun run hooks/<name>.ts`. Spawn only `git`,
  `tmux`, `gh`, `docker`, `claude`.
- Every CLI command prints JSON on stdout; human text goes to stderr.
- Agent roles are Markdown with frontmatter in `agents/`; workflows are plain JavaScript
  in `workflows/`; check both against the current Claude Code docs, not memory.
- Do not commit unless asked.

## Glossary

One name per concept, in code, docs, prompts and JSON. Code names in brackets.

| Term | Meaning |
|---|---|
| task | One tracker item, worked on from start to merge. |
| task id | The tracker's id, `TEN-301`; letters, digits, `_`, `-` (`TaskId`). |
| project | One repository Tenbox works on; its name comes from `project:` or the directory (`Project`). |
| main checkout | The project's own clone, `~/wt/<project>/main` (`mainDir`). |
| worktree root | The directory that holds every project's checkouts, `~/wt` (`wtRoot`). |
| task worktree | The git worktree of one task, `~/wt/<project>/<id>` (`taskWorktree`). |
| archive | Where a closed task's `.tenbox/` goes, `~/wt/.archive/<project>/<id>` (`archiveDir`). |
| manifest | `tenbox.yaml` plus its local layers (`Manifest`). |
| setup | The manifest command that prepares a new task worktree, e.g. `bun install`. |
| check | One named command under `checks:`; `tenbox check` runs them all. |
| failure line | One output line of a check that matches the failure pattern (`FailureLine`). |
| baseline | The failure lines a check has on `main` at one commit (`Baseline`). |
| new failure | A failure line not in the baseline; the only thing that fails a check. |
| fixed | A baseline failure line that no longer appears. |
| round | One pass of build, checks and review inside `/tenbox-build`. |
| part | One piece of a task's plan with its own files; one part file each in `.tenbox/parts/`. |
| feedback | What a failed round passes to the next one: new failures or must-fix items. |
| role | A Tenbox subagent: planner, worker, reviewer, runner. |
| stats | The record `tenbox close` writes to `<archive>/stats.json`: numbers and labels of one task (`TaskStats`). |
| tracker | The adapter to Linear (or none) (`Tracker`, `TrackerKind`). |

## Code rules

The roles carry the general code shape rules (`agents/worker.md`). For this repo also:

- Signatures use named types: `state: TmuxState`, not `StartResult["tmux"]["state"]`; no `Omit<>`,
  `Pick<>` or indexed types in a parameter. A shape used twice gets a name.
- Layers and their direction: `domain/` imports nothing from `application/` or `infra/`;
  `infra/` imports only `domain/`; `application/` imports both, directly: no ports bag, no
  dependency injection. The one port is `Tracker`, because its adapter is chosen at run time.
- In `application/`, one module per glossary concept, named in the plural:
  `projects.find()`, `worktrees.open()`. A module is one file, or a folder whose `index.ts`
  exports the module object; other modules import only that. A function name does not repeat
  the module name.
- `application/` never runs raw git commands (`git.run`): it calls the named ones in
  `infra/git.ts`. A tool's file format or command line lives in `infra/`.
- Verbs in module APIs: `get` (throws when missing), `find` (null when missing), `ensure`
  (creates when missing, keeps what exists), `save`, `update`, `remove`, `run`. One verb, one
  meaning.
- Tests run against real temporary git repositories and directories, not fakes.
- No magic numbers: name the constant. No inline casts.
- `await` only at the start of a statement or an assignment: `const x = await f();`. Never
  inside a condition, an argument, an object literal, a `??` or a spread.
- Biome formats `cli/` at 100 columns (`biome.json`); the `format` check fails on unformatted
  code. Run `bunx biome format --write cli` before a commit.
- A branded type has one constructor function, the only place with `as`.
- Generic helpers live in `cli/domain/utils.ts`; search there before writing one.
- Less code is always better: no code for a later phase.

## Layout

```
cli/        tenbox CLI, entry cli/main.ts; cli/args.ts reads the command line
  domain/       pure code: ids, failure lines, manifest schema, the Tracker port
  application/  use cases, and one module per glossary concept, named in the plural
    commands/     one file per CLI command, named after it; results.ts is their JSON output
    manifests  projects  worktrees/  tasks  setups  sessions  baselines  stats
  infra/        the outside world: files, git, gh, shell, tmux, processes, env, baselineStore,
                claudeSettings, claudeSessions, http, graphql
    tracker/      the Tracker adapters and makeTracker
  test/         tempProject.ts, cli.ts (runs the real CLI) and the end-to-end test
agents/     planner.md, worker.md, reviewer.md, runner.md
workflows/  tenbox-plan.js, tenbox-build.js
docs/       design.md (the target design), flow page and mockups
hooks/  schemas/  pane/  panel/   empty until a later phase (docs/design.md)
```

## Trying it

A scratch project for the first runs lives outside this repo, in `~/wt/tenbox-demo/`
(a small Bun + Hono API). `tenbox start DEMO-1 --title "..."` opens a worktree there.
`tenbox install` links `agents/` and `workflows/` into `~/.claude/`.
