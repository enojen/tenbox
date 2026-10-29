---
name: tenbox
description: Run one tracker task (an id like TEN-301) through plan, build, check, review, PR and close with the tenbox CLI, on this computer or as a Job on the cluster. Use in a git project with a tenbox.yaml, or to add one, when the user asks to start, plan, approve, build, check, open the PR for, close or see the status of a task.
allowed-tools: Bash(tenbox help *)
---

# Tenbox

Tenbox runs one tracker task in its own worktree and background Claude Code session, with
four roles (planner, worker, reviewer, runner) and the workflows `/tenbox-plan`,
`/tenbox-build` and `/tenbox-close`. It changes every day, so this skill holds no command
details: they come from the tenbox you have now.

## The commands, from the installed tenbox

!`tenbox help 2>&1 >/dev/null || echo "tenbox is not on PATH: see the Install section of the README"`

## One command

Run `tenbox help <command>` before you use a command. It prints the flags, the input, the
output fields and an example.

## The reference

For the flow of a task, the files of a task and `tenbox.yaml`, read the
[reference](https://github.com/enojen/tenbox/blob/main/docs/reference.md). For one command,
`tenbox help <command>` is right where the two disagree.

## How to work with it

- One task: `tenbox start`, then the plan (`tenbox plan show`), `tenbox approve`,
  `tenbox build`, `tenbox pr`, the merge on GitHub, `tenbox close`. `tenbox wait`,
  `tenbox status` and `tenbox list` tell you where a task stands.
- Every command prints JSON on stdout: read `ok`, and on a failure `code` and `error`.
  Human text goes to stderr.
- Change a task only with tenbox commands, never by editing its `.tenbox/` files.
- The approval of a plan, the answer to a question or a decision card, and the merge
  belong to the user. Show them what tenbox printed and wait.
- A bug or a gap outside the task at hand, seen on the way: open it with `tenbox task new`
  in the project's tracker (title, why, what, done when) and go on; the task at hand stays
  small. In a build, the reviewer returns such items as `findings` and `tenbox build done`
  opens them.
- A bug or a missing piece of Tenbox itself: show the user the draft and run
  `tenbox report` only after they say yes, never alone (`--repo tenyard` for the cluster,
  the box and the Jobs). A workflow never reports.
- On the cluster: `tenbox machine run <id> -- <command>` runs one tenbox command of the task
  as a Job, from the templates of [Tenyard](https://github.com/enojen/tenyard); see
  "Machines" in the reference. After its close Job ends, `tenbox machine rm <id>` deletes the
  task's volume; run it only then, it cannot be undone.
