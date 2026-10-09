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
cleanup only, no sandbox and no merge), `tenbox pr` (push, then create or update the PR
with `gh`), `tenbox build` (types `/tenbox-build` into the task's `claude` session on the
task's own tmux server) and `tenbox merge-check` (merge the open task PRs in a temporary
worktree and run the checks); next is `/tenbox-close`. No sandbox yet.

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
| project id | The project's id in `tenbox.yaml`: 6 characters, a-z and 0-9, e.g. `k7f3qa`; stays when the name changes (`ProjectId`). |
| main checkout | The project's own clone, `~/wt/<project>/main` (`mainDir`). |
| worktree root | The directory that holds every project's checkouts, `~/wt` (`wtRoot`). |
| task worktree | The git worktree of one task, `~/wt/<project>/<id>` (`taskWorktree`). |
| task dir | Where one task's files live, `~/.tenbox/<project id>/<id>`; `.tenbox` in the task worktree links to it (`taskDir`). |
| manifest | `tenbox.yaml` plus its local layers (`Manifest`). |
| setup | The manifest command that prepares a new task worktree, e.g. `bun install`. |
| check | One named command under `checks:`; `tenbox check` runs them all. |
| failure line | One output line of a check that matches the failure pattern (`FailureLine`). |
| baseline | The failure lines a check has on `main` at one commit (`Baseline`). |
| new failure | A failure line not in the baseline; the only thing that fails a check. |
| fixed | A baseline failure line that no longer appears. |
| approval | `approved.json` in the task dir, written by `tenbox approve`: the time and the sha of `plan.md` (`Approval`). |
| round | One pass of build, checks and review inside `/tenbox-build`. |
| part | One piece of a task's plan with its own files; one part file each in `.tenbox/parts/`. |
| feedback | What a failed round passes to the next one: new failures or must-fix items. |
| plan result | What the planner returns and `tenbox plan done` saves as `plan.json`: summary, estimated lines, parts `{ id, difficulty }`, criteria, lenses, questions (`PlanResult`). |
| role | A Tenbox subagent: planner, worker, reviewer, runner. |
| stats | The record `tenbox close` writes to `<task dir>/stats.json`: numbers, labels, proofs (test file, test name, failure text) and points per part of one task (`TaskStats`). |
| build result | What `/tenbox-build` returns and `tenbox build done` saves as `build.json`: status, round, proofs, attention, nice-to-have, unproven (`BuildResult`). |
| proof | One record `{ part, file, test, failure }`: the test that failed before the code and how. It is recorded in `.tenbox/proofs.json` by `tenbox build done` or by hand (`tenbox proof`) (`StatsProof`). |
| unproven | A reviewer item `{ part, reason }`: a part whose change of behaviour has no proof (`Unproven`). |
| points | Per part in stats: +1 per distinct test among its proofs, -1 per unproven item (`StatsPoints`). |
| organization | A group of users on the server; found by name (`organizations`). |
| user | A person on the server, with a GitHub name and one token (`users`). |
| membership | A user in an organization, with a type `admin` or `member`. |
| token | A secret `tbx_` string for the HTTP API; only its hash is stored. |
| tracker | The adapter to Linear (or none) (`Tracker`, `TrackerKind`). |

## Code rules

The roles carry the general code shape rules (`agents/worker.md`). For this repo also:

- Signatures use named types (`rules/named-parameter-types`). A shape used twice gets a name.
- Layers and their direction: `domain/` imports nothing outside itself; `cli/infra/` imports
  only `domain/`; `cli/application/` imports both, directly: no ports bag, no dependency
  injection; `cli/commands/` imports all three. The one port is `Tracker`, because its
  adapter is chosen at run time. `cli/test/layers.test.ts` checks the `domain/` and
  `cli/infra/` rules.
- In `application/`, one module per glossary concept, named in the plural:
  `projects.find()`, `worktrees.open()`. A module is one file, or a folder whose `index.ts`
  exports the module object; other modules import only that. A function name does not repeat
  the module name.
- Errors come from named functions in `domain/errors/<kind>.ts`, never `new TenboxError(`
  elsewhere (`rules/errors-from-domain`).
- No `JSON.parse(JSON.stringify(x))`: copy with `structuredClone` (`rules/no-json-roundtrip`).
- In `*.test.ts`, no ternary inside `expect(...)`: assert each case (`rules/no-conditional-expect`).
- In `*.test.ts`, never take a caught error out of a catch; use `toThrow` or `rejects`
  (`rules/no-caught-error-in-tests`).
- `application/` calls the named git functions in `infra/git.ts` (`rules/no-raw-git-in-application`).
  A tool's file format or command line lives in `infra/`.
- Start a process only through `cli/infra/processes.ts` (`rules/no-raw-spawn`).
- Parse JSON only with `parseJson` / `parseObject` from `domain/utils.ts` (`rules/no-raw-json-parse`).
- Outside `domain/` and `cli/infra/`, read a Tenbox file with a `read*` function in `domain/`
  (`rules/json-readers-in-domain`).
- Write a JSON file with `files.writeJson` (`rules/write-json-once`).
- Verbs in module APIs: `get` (throws when missing), `find` (null when missing), `ensure`
  (creates when missing, keeps what exists), `save`, `update`, `remove`, `run`. One verb, one
  meaning.
- Tests run against real temporary git repositories and directories, not fakes.
- Prove first: no fix and no feature on a guess. Write the test, see it fail, write the code,
  see it pass; for a fix, undo it once and see the test fail again (`agents/worker.md`).
- The `lint` check owns the rules on await, casts, magic numbers and import order: the
  plugins in `rules/` (one folder per rule, with `rule.md`) and the rules in `biome.json`.
- Biome formats `cli/`, `domain/`, `server/` and `rules/` at 100 columns (`biome.json`); the `format` check fails
  on unformatted code. Run `bunx biome format --write cli domain server rules` before a commit.
- A branded type has one constructor function.
- `exactOptionalPropertyTypes` is on: `a?: T` = the key may be missing; `a: T | undefined` = the key
  is always set. Never both.
- Generic helpers live in `domain/utils.ts`; search there before writing one.
- Data that code counts comes from a schema or a JSON file, never from Markdown.
- Less code is always better: no code for a later phase (`unused` check, knip).

## Layout

```
domain/     pure code: ids, failure lines, manifest schema, events, the Tracker port,
            errors/ (`index.ts`: `TenboxError`; one file per kind: auth, usage, users, projects, git, tools,
            manifest, tasks; HTTP status lives in server/routes/)
cli/        tenbox CLI, entry cli/main.ts; cli/args.ts reads the command line
  commands/     one file per CLI command, named after it; results.ts is their JSON output
  application/  use cases, and one module per glossary concept, named in the plural
    manifests  projects  worktrees/  tasks  setups  sessions  baselines  stats  parts  proofs  builds
    approvals  plans  checks
  infra/        the outside world: files, git, gh, shell, tmux, processes, env, baselineStore,
                claudeSettings, claudeSessions, http, graphql
    tracker/      the Tracker adapters and makeTracker
  test/         tempProject.ts, cli.ts (runs the real CLI), the end-to-end test and the
                layers test
server/     the HTTP server (Hono + @hono/zod-openapi), entry server/main.ts: routes/ (one zod
            schema per route, `/openapi.json`, Swagger UI on `/docs`, `problems.ts`: every
            error as an RFC 9457 problem), application/ (the rules: organizations, users, projects),
            commands/ (`tenbox-server user add`, `project add`), infra/ (env, tokens, db/ with the drizzle
            schema and migrations, repositories/: data access per table, no rules);
            application/ imports repositories/ directly; imports only server/ and domain/,
            never cli/; cli/ never imports server/ (`cli/test/layers.test.ts`)
agents/     planner.md, worker.md, reviewer.md, runner.md
workflows/  tenbox-plan.js, tenbox-build.js
rules/      Biome GritQL plugins of the lint check: rule.grit, bad.ts, good.ts, rule.md;
            rules.test.ts proves each one
docs/       design.md (the target design), flow page and mockups
hooks/  schemas/  pane/  panel/   empty until a later phase (docs/design.md)
```

## Trying it

A scratch project for the first runs lives outside this repo, in `~/wt/tenbox-demo/`
(a small Bun + Hono API). `tenbox start DEMO-1 --title "..."` opens a worktree there.
`tenbox install` links `agents/` and `workflows/` into `~/.claude/`.
