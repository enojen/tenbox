---
name: tenbox
description: Run one tracker task (an id like TEN-301) through plan, build, check, review, PR and close with the tenbox CLI, on this computer or as a Job on the cluster. Use in a git project with a tenbox.yaml, or to add one, when the user asks to start, plan, approve, build, check, open the PR for, close or see the status of a task.
allowed-tools: Bash(tenbox help *) Bash(realpath *)
---

# Tenbox

Tenbox runs one tracker task in its own worktree and background Claude Code session, with
four roles (planner, worker, reviewer, runner) and the workflows `/tenbox-plan`,
`/tenbox-build` and `/tenbox-close`. It changes every day, so this skill holds no command
details: they come from the tenbox you have now.

## The commands, from the installed tenbox

!`tenbox help 2>&1 >/dev/null || echo "tenbox is not on PATH: see the Install section of the README"`

## The reference

Every command, file and rule, as built today, is in the reference of this checkout:

!`realpath "${CLAUDE_SKILL_DIR}/../../docs/reference.md"`

Read the section you need before you act: "How a task runs today" for the flow, "The CLI"
for one command, "The manifest" for `tenbox.yaml`, "Machines" for the cluster. Where this
skill and the reference disagree, the reference is right.

## How to work with it

- One task: `tenbox start`, then the plan (`tenbox plan show`), `tenbox approve`,
  `tenbox build`, `tenbox pr`, the merge on GitHub, `tenbox close`. `tenbox wait`,
  `tenbox status` and `tenbox list` tell you where a task stands.
- Every command prints JSON on stdout: read `ok`, and on a failure `code` and `error`.
  Human text goes to stderr.
- Change a task only with tenbox commands, never by editing its `.tenbox/` files.
- The approval of a plan, the answer to a question or a decision card, and the merge
  belong to the user. Show them what tenbox printed and wait.
- On the cluster: `tenbox machine run <id> -- <command>` runs one tenbox command of the task
  as a Job, from the templates of [Tenyard](https://github.com/enojen/tenyard); see
  "Machines" in the reference. After its close Job ends, `tenbox machine rm <id>` deletes the
  task's volume; run it only then, it cannot be undone.
