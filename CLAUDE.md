# CLAUDE.md

Tenbox: a thin layer on top of Claude Code that runs one tracker task through plan,
build, check, review, try and merge with workflows and custom subagents. The design is
`README.md`; read it first, it is the spec. Where code and README disagree, fix one of
them in the same change.

## Status

Phase 1 of the roadmap (README, "Start here: phase 1"): roles, `/tenbox-plan`,
`/tenbox-build` without the Try phase, `tenbox start`, `tenbox check`, `tenbox install`.
No sandbox, no PR, no tracker API yet (`tenbox start --title` instead).

## Rules

- TypeScript on Bun, few dependencies, no Python. Code, docs and agent prompts in English.
- Must run on macOS and Linux from the first commit: `os.homedir()` and `path.join`, no
  GNU-only or BSD-only shell flags, hooks as `bun run hooks/<name>.ts`. Spawn only `git`,
  `tmux`, `gh`, `docker`, `claude`.
- Every CLI command prints JSON on stdout; human text goes to stderr.
- Agent roles are Markdown with frontmatter in `agents/`; workflows are plain JavaScript
  in `workflows/`; check both against the current Claude Code docs, not memory.
- Do not commit unless asked.

## Layout

```
cli/        tenbox CLI, entry cli/main.ts; cli/tracker/ holds the tracker adapters
agents/     planner.md, worker.md, integrator.md, reviewer.md, qa.md, runner.md
workflows/  tenbox-plan.js, tenbox-build.js, tenbox-close.js
hooks/      locked-paths.ts, qa-no-code.ts
schemas/    JSON schemas for agent outputs and tenbox.yaml
pane/       later: live pane plugin
panel/      later: web panel
docs/       flow page and mockups
```

## Trying it

A scratch project for the first runs lives outside this repo, in `~/wt/tenbox-demo/`
(a small Bun + Hono API). `tenbox start DEMO-1 --title "..."` opens a worktree there.
`tenbox install` links `agents/` and `workflows/` into `~/.claude/`.
