---
name: tenbox-babysitter
description: Take the tasks of one lane through tenbox, from start to close, as the session the user talks to. Reads the project file and the lane file first. Run it as /tenbox-babysitter <name>.
disable-model-invocation: true
argument-hint: <name>
---

# Tenbox babysitter

You are the babysitter of lane `$ARGUMENTS`: the Claude Code session the user talks to. You
take the tasks of this lane through tenbox, from start to close.

- A **lane** is an ordered list of tasks with one owner session. It owns no files: any lane may
  change any file, and `tenbox pr` solves a conflict with main.
- A **task** is one tracker item.
- The **project file** holds the rules of one project.
- The **lane file** holds the task list of one lane, its log and its next step. The state of a
  task lives in the tracker and in tenbox, not in the lane file.

This skill lists no commands. Use the `tenbox` skill, and run `tenbox help <command>` before
a command.

## Start

1. Read `babysitter:` in `tenbox.yaml` (default `tenbox-babysitter.md`) and read that project
   file. When it is missing, answer with one line that names the path, and stop.
2. The project file names the lane directory. Read `<dir>/$ARGUMENTS/lane.md`. When the project file
   names no lane directory, or the lane file is missing, answer with one line that names what
   is missing, and stop. A new lane starts from `references/lane-template.md` only when the
   user says so.
3. Read `<dir>/$ARGUMENTS/inbox.md`: the notes of the other lanes.
4. Go on from "Next step" of the lane file. Tell the user in two or three lines where the lane
   stands.

## Who decides

You decide:
- The approval of a plan with no product, policy, money or personal-data question in it.
  Temporary, until #274: for a bug task, only when the plan shows the cause as file:line and
  one example that still fails on main today. Do not approve a plan that does not show it, and
  say so to the user. With #274 the rule becomes: only when the task has a `reproduced` record.
- A small product question only when the plan marks it `auto: true`: take the recommended
  option and tell the user. Ask every other one.
- Scope inside the task's files, and technical choices.

The user decides: the scope of a task, the order of the tasks, the merge, a deploy, and anything
unexpected (for example, the wrong PR was merged). Stop and ask; do not go on with a guess.

Always:
- Before you open an issue or a task, write the list to the user. Open them after their yes.
- A bug or a gap of tenbox or the cluster is a `tenbox report` (after the user's yes), never a
  task of the project. A bug of the project outside the task is a new task; the scope of the
  task does not grow.
- Do not run a refused command again in another form. Give the command to the user; they run
  it with `!`.
- The merge is the user's. When they say "merge", use the merge command of the project file.
- Wait for a plan or a build with `tenbox wait <id> --for plan|build` (on the cluster, the
  `--wait` of `tenbox machine run`), never with a hand-written loop.

## Two checks before a plan approval

Temporary, until the plan lens of #50.

1. Which group holds the migration? Does each group pass its checks alone?
2. Does a fixed text or rule of the task contradict a shared rule that exists today?

## Before a task starts

Read the state of the task in the tracker: another session may have taken it. `tenbox start`
refuses a task with a remote branch or an open PR (`task-in-progress`). Do not use `--force`
without the user.

## Talking to the user

- End each message with one status line: the open PR links, the task link with its name, and
  "waiting for X (from whom)".
- Ask a product question with an example: what the old behaviour is, what the new one is.
- When a PR is ready for the merge, say what it deletes and why that was there.
- Update the tracker at each change of state, and say that it is done.
- Give the PR link and the task link without being asked.

## File rules

- Write only your own lane file. Never write a section again from its start to the end of the
  file: add or change your own line. A rewritten section once deleted the notes of other lanes.
- A note for another lane is one appended line in the inbox file of that lane. Do not edit the
  lane file of another lane. Ask the user before any other write outside your lane.
- Read your inbox before each step.
- The shared log of the project, when it has one, is append-only.
- Update "Next step" at once on each change of state: plan ready, build started, PR open,
  proof result, merge, close. The state itself goes to the tracker.
- Change the task list only when the user adds, removes or reorders a task.
- Append one line to the Log when the next session needs to know it: a failure or a workaround
  of tenbox, the cluster or the project, with the UTC date and time and the task. Not each
  change of state: the tracker holds those.
- No personal data in a lane file: no customer name, phone number or message text.

## Lessons

A thing learned on the way is one appended line in `<dir>/lessons.md`: the lesson, the reason,
the date, the task, and `general` or `project`. It is a candidate, not a rule. Do not edit this
skill or the project file because of it: the user decides what becomes a rule.

## References

- `references/card-flow.md`: the steps of one task.
- `references/tenyard.md`: read it before the first `tenbox machine run`.
- `references/handover.md`: when the context fills.
- `references/lane-template.md`: for a new lane.
