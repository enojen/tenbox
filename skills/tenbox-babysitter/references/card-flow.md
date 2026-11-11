# The steps of one task

On the cluster each command is `tenbox machine run <id> --wait -- tenbox <command> <id> ...`; on
this computer it is the same command without the prefix. `--wait` returns the result JSON of the
command, so you need no wait loop and no search in the logs. Run `tenbox help <command>` before
a command.

1. Start: `tenbox start <id>`. The tracker goes to in progress and the plan starts.
2. Plan: wait for it with `tenbox wait <id> --for plan` (on the cluster, the `--wait` of
   `tenbox machine run`), never with a hand-written loop. Then `tenbox plan show <id>`. It shows
   parts, groups, examples, decisions and questions.
3. Checks before the approval: the three checks of `SKILL.md`, and the rule for a bug task.
4. Questions: answer with
   `tenbox decide <id> --no-build --json '[{"question": 1, "answer": "..."}]'`, with `question`
   the number that `tenbox plan show` gives the question (its text works too).
   Temporary, until #249: `answer` is one line. Read `ok: true` in the output before the
   approval. Temporary, until #160: `approve` and `build` do not stop on an open question, so
   look at the question list yourself.
5. A decision that holds for every task of the project belongs in `decisions:` of
   `tenbox.yaml`, not in a note typed on each task.
6. `tenbox approve <id>`, then `tenbox build <id>`.
7. Build: wait for its end with `tenbox wait <id> --for build` (on the cluster, the `--wait` of
   `tenbox machine run`), never with a hand-written loop. Then `tenbox status <id>`. A failed
   build has its cause in `reason`. A decision card: the user answers, unless it is
   `auto: true`; then `tenbox answer <id> <n>`.
8. A part that is `done` but needs one more thing:
   `tenbox part reopen <id> --part NN --accept "..."`, then `tenbox build <id>`. Never edit a
   part file by hand. Temporary, until #283: this command does not run on the cluster yet, so
   tell the user.
9. Draft PR: the build opens it. `tenbox pr <id>` tells a conflict with main and runs the checks
   of each group.
10. The proof of the project (the project file says what it is, who may run it and the pass
    rule). When it fails, a new round starts with
    `tenbox decide <id> --json '[{"answer": "<what failed, which kind of case, what is expected>"}]'`.
11. Ready: `tenbox pr <id> --ready`. Temporary, until #276 and #278: `tenbox pr` writes the PR
    body again on every run, so add the proof table after it with
    `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@<file>`. Add it again after each
    later `tenbox pr`.
12. Tell the user: the PR link, what changed, what it deletes and why, the proof. Wait for the
    merge.
13. After the merge: `tenbox close <id>`. On the cluster, when the close Job has ended,
    `tenbox machine rm <id>`; it deletes the task volume and cannot be undone. Then write the
    work log on the task: what changed, the PR, the proof result, how to try it. Temporary,
    until #279: when the project file asks for a measurement of main after a merge, the lane
    whose PR was merged runs it and appends one line to the shared log.
14. Update the lane file.

## Groups

The groups of a plan merge in order, one PR each; no stacked PR. The branch of group 2 is
pushed only after group 1 is merged, so its proof waits for that merge.

## A branch on an old main

Before the proof, see that the branch holds today's main. `tenbox pr` takes main only on a
conflict; a proof on an old branch compares the wrong things.

## A test that needs Docker

Temporary, until #251: a test that needs Docker fails on the box, and the build can say
`failed` for it. Read `reason`. When only that test fails, tell the user and start no new
rounds for it.
