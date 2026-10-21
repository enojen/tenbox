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
with `gh`), `tenbox build` (starts `claude --bg` with `/tenbox-build` in the task worktree;
`tenbox start` does the same with `/tenbox-plan`, `tenbox attach` opens the session, `tenbox
close` stops it), `tenbox stats` and `tenbox merge-check` (merge the open task PRs in a temporary
worktree and run the checks) and `/tenbox-close` (one runner step `tenbox close`, which also
pulls the base and deletes the remote branch after a MERGED PR) and the ClickUp tracker.
Phase 3 (machines, `docs/design.md` "Machines") has started: the Packer image, the task
module, the control plane `machine.yml` + `machines/machine.sh` (start, build, close, down, destroy;
state in a bucket), the watchdog that asks for `down` and the login sync (TEN-419 to
TEN-422), and `tenbox machine run` and `ls` (TEN-423). With `machine: k8s`, the default,
`tenbox machine run` posts a Job to namespace `tenbox` of the cluster from `<template>/job.yaml`
and `ls` lists the Jobs labeled `app=tenyard`; with `machine: hetzner` they start and list
`machine.yml` runs (TEN-465). No sandbox yet.

## Rules

- TypeScript on Bun, few dependencies, no Python. Code, docs and agent prompts in English.
  `machines/` is the exception: Packer HCL, systemd units and bash that run on Ubuntu only.
- Must run on macOS and Linux from the first commit: `os.homedir()` and `path.join`, no
  GNU-only or BSD-only shell flags, hooks as `bun run hooks/<name>.ts`. Spawn only `git`,
  `gh`, `docker`, `claude` and tenbox itself (`process.execPath`).
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
| flaky | A new failure line of a check's first run that its rerun does not repeat; listed under `flaky`, it does not fail the check. |
| fixed | A baseline failure line that no longer appears. |
| approval | `approved.json` in the task dir, written by `tenbox approve` after it checks the plan as `tenbox plan done` does: the time and the sha of `plan.json` (`Approval`). |
| round | One pass of build, checks and review inside `/tenbox-build`. |
| part | One piece of a task's plan with its own files; one part file each in `.tenbox/parts/`. |
| feedback | What a failed round passes to the next one: new failures or must-fix items. |
| kind | A task's flow depth, `docs`, `small`, `normal` or `large`: a preset of review lenses, check tier, review rounds and diff limits; `normal` when a plan names none (`TaskKind`, `KIND_PRESETS`). |
| plan result | What the planner returns and `tenbox plan done` saves as `plan.json`: kind, summary, estimated lines, parts `{ id, difficulty }`, examples, plan decisions, lenses, questions, groups (`PlanResult`). |
| example | One before and after of a part in `plan.json`: `{ part, title, before, after }`; `title` names the worker test that proves it. |
| plan decision | One real choice in `plan.json`: `{ title, options, taken, reason }`, `taken` counted from 1; `tenbox decide` with `{ decision, taken }` overrides it (`PlanDecision`). Not a decision card. |
| group | One or more parts that become one PR; has a name, `needs` (smaller group ids) and a recipe (`Group`). |
| group worktree | The worktree of a group above 1, `~/wt/<project>/<id>-<N>` on `<task branch>-<N>`; group 1 is the task worktree (`groupWorktreeDir`). |
| PR | The GitHub pull request of one group; its body starts with the group line `tenbox: <id> group <N>` (`groupLine`, `GroupPr`). |
| recipe | How a group is built: worker model and effort, review lenses, check tier (`Recipe`). |
| role | A Tenbox subagent: planner, worker, reviewer, runner. |
| stats | The record `tenbox close` writes to `<task dir>/stats.json`: numbers, labels, proofs (test file, test name, failure text) and points per part of one task (`TaskStats`). |
| build result | What `/tenbox-build` returns and `tenbox build done` saves as `build.json`: status, round, proofs, attention, nice-to-have, unproven (`BuildResult`). |
| proof | One record `{ part, file, test, failure }`: the test that failed before the code and how. It is recorded in `.tenbox/proofs.json` by `tenbox build done` or by hand (`tenbox proof`) (`StatsProof`). |
| unproven | A reviewer item `{ part, reason }`: a part whose change of behaviour has no proof (`Unproven`). |
| points | Per part in stats: +1 per distinct test among its proofs, -1 per unproven item (`StatsPoints`). |
| decision | One answer or note in `.tenbox/decisions.md`, added by `tenbox decide` or `tenbox answer`; a plan decision override adds the note `<title>: <option text>`; a question answer also ticks its line in `questions.md` (`Decision`). |
| decision card | What a blocked worker returns: `{ title, options, recommended, reason, auto, kind }`; `kind` is one of eight, six of them never auto-answered; `build.json` keeps it with `deadline` and, after `tenbox answer`, `answered` (`DecisionCard`). |
| auto answer | The recommended option of an `auto` card, taken by `tenbox answer --auto` when its deadline passes with no answer (`autoAnswers`). |
| organization | A group of users on the server; found by name (`organizations`). |
| user | A person on the server, with a GitHub name and one token (`users`). |
| membership | A user in an organization, with a type `admin` or `member`. |
| token | A secret `tbx_` string for the HTTP API; only its hash is stored. |
| notification | One text line `<project> · <task id> · <state> · <detail> → <next command>` sent to the manifest's `notify.ntfy` URL when a person must act; states: needs-you, ready-for-you, failed, check-failed, pr-opened, plan-ready, blocked (`Notification`). |
| ready-for-you | The notification state of `tenbox build done` with status ready-for-you; the detail is `round N, attention A, nice-to-have B, unproven C`, counted from `build.json`. |
| check-failed | The notification state of a `tenbox check` with a new failure; the line says "the build goes on" while there is no `build.json`. |
| pr-opened | The notification state of `tenbox pr` when it creates the PR; the detail is the PR URL. |
| plan-ready | The notification state of `tenbox plan done`; the detail is the part and open question counts. |
| status report | The state of one task read from its files, its background session and its PR: the `task.json` status, round, parts, session, PR, last check; `tenbox status` prints it (`StatusReport`). |
| blocked | The notification state of `tenbox hook blocked`: the task's background session waits on a permission prompt; the detail is the prompt's message. |
| machine | Where the tenbox commands of one task run, chosen by `machine:` of the manifest: with `k8s` (the default) the pod of a Job on the cluster, with `hetzner` a short-lived cloud server of the task, started and stopped by `machine.yml` (`machines`). |
| machine run | One tenbox command of a task on its machine: with `k8s` (the default) one Job in namespace `tenbox`, filled from `<template>/job.yaml`; with `hetzner` one `machine.yml` workflow run. `tenbox machine run` starts it; `tenbox machine ls` lists them, on `k8s` the Jobs labeled `app=tenyard` (`machines.run`). Not a `run` in stats, which is one Claude Code workflow run. |
| session link | `https://claude.ai/code/<bridgeSessionId>` of the newest Claude session of a task worktree; the `click` of every notification (`sessionLinks`). |
| tracker | The adapter to Linear (or none) (`Tracker`, `TrackerKind`). |

## Code rules

The roles carry the general code shape rules (`agents/worker.md`). For this repo also:

- Signatures use named types (`rules/named-parameter-types`). A shape used twice gets a name.
- A function takes its parameter object whole and destructures it in the body
  (`rules/no-destructured-parameters`).
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
    approvals  plans  groups  prs  checks  decisions  notifications  answers  autoAnswers  machines  statusReports
  infra/        the outside world: files, git, gh, shell, processes, env, baselineStore, http, notify (ntfy),
                graphql, kubernetes (the cluster API: Jobs and volumes); claude/ (background sessions, session files, transcripts, settings)
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
workflows/  tenbox-plan.js, tenbox-build.js, tenbox-close.js
rules/      Biome GritQL plugins of the lint check: rule.grit, bad.ts, good.ts, rule.md;
            rules.test.ts proves each one
machines/   packer/ (the image: template, build.sh, scripts/), tofu/task/ (volume + server per task,
            cloud-init, tenbox-boot.sh), machine.sh (one command of .github/workflows/machine.yml;
            local.sh runs it from your computer), login/ (the claude.ai login sync from your
            computer to the bucket), watchdog/ (script, service, timer), k8s/ (the box image:
            Dockerfile, boot.sh; .github/workflows/box.yml pushes it to GHCR on every merge)
docs/       design.md (the target design), flow page and mockups
hooks/  schemas/  pane/  panel/   empty until a later phase (docs/design.md)
```

## Trying it

A scratch project for the first runs lives outside this repo, in `~/wt/tenbox-demo/`
(a small Bun + Hono API). `tenbox start DEMO-1 --title "..."` opens a worktree there.
`tenbox install` links `agents/` and `workflows/` into `~/.claude/`.
