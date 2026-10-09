# Tenbox hierarchy

Read from the code (`cli/domain/`, `cli/application/`) at commit 9d90eeb.

Notes:
- The tracker is not inside a task. It is in the manifest, at project level. A task only
  keeps which tracker it came from (`tracker: TrackerKind`).
- A baseline belongs to the project, not to a task: one per check and per commit.

## Directories and data

```
~/wt/                                   worktree root (wtRoot)
│
├── <project>/                          PROJECT (Project: name, mainDir, commonDir)
│   │
│   ├── main/                           main checkout (mainDir)
│   │   └── tenbox.yaml                 MANIFEST (+ local layers)
│   │       ├── project                 project name
│   │       ├── base                    "main": tasks start from it and merge into it
│   │       ├── setup                   e.g. "bun install"
│   │       ├── failure_pattern         regex that finds a failure line
│   │       ├── checks: { name: cmd }   CHECKs
│   │       ├── tracker                 TRACKER (kind: none | linear, api_key)
│   │       │     └── Tracker port → getTask(), updateStatus()
│   │       └── names                   branch "feat/{id}", tmux "tenbox-{id}"
│   │
│   └── <TEN-301>/                      TASK WORKTREE (taskWorktree)
│       ├── (code, branch feat/TEN-301)
│       └── .tenbox/                    task state
│           ├── task.md                 TASK (id, title, description, url, status, tracker kind)
│           ├── plan.md                 written by the planner (Estimated lines)
│           ├── parts/NN-*.md           PARTs (each: goal, files, difficulty)
│           ├── proofs.json             PROOFs recorded by hand (tenbox proof)
│           └── rounds/<N>/             ROUND (build → check → review)
│               └── checks.json         result of tenbox check
│                     ├── per check → NEW FAILURE lines
│                     ├── fixed (baseline lines that no longer appear)
│                     └── summary → FEEDBACK for the next round
│
├── (tenboxHome)/<project id>/<TEN-301>/  the task dir; tenbox close adds
│   └── stats.json                      STATS (TaskStats)
│         ├── timeline, minutes         plan / wait approval / build / human review
│         ├── plan                      parts count, difficulty[], estimated_lines
│         ├── rounds[]                  { number, checks_passed }
│         ├── review                    must_fix, nice_to_have, attention counts
│         ├── proofs[]                  PROOF { part, file, test, failure }
│         ├── points[]                  POINTS { part, points }: +1 per proof, -1 per unproven
│         ├── code                      added, removed, files, test_added
│         └── agents[]                  per agent: role, model, seconds, tokens
│
└── (baselinesRoot)/<project>/<check>/<sha>   BASELINE: failure lines on main at that commit
```

## Where the runs come from

```
Claude Code session files
└── WorkflowRun (tenbox-plan / tenbox-build)
    ├── agents[]  → RunAgent          → stats.agents
    └── result
        ├── proofs[]   (worker)       → StatsProof  → stats.proofs, points
        └── unproven[] (reviewer)     → Unproven → points (-1)
```

## Flow in short

1. A project has a manifest.
2. The manifest defines the checks, the tracker and the name templates.
3. A task opens a task worktree.
4. Inside the worktree, the plan makes parts and the build makes rounds.
5. Each round makes failures and feedback.
6. `tenbox close` writes `stats.json` in the task dir and keeps the dir.
