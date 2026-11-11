# Tenbox reference

Tenbox runs one tracker task through plan, build, check, review and merge with Claude Code
workflows and custom subagents. It is a thin layer: Claude Code does the agents and the
orchestration; Tenbox adds the roles, two workflows, a task layout on disk and a small CLI
for the steps an agent should not improvise.

This page describes what is built and how it runs today. Every statement here must be
true of the code. The target design (sandbox, QA, parallel workers, the panel) is in
[`docs/design.md`](design.md); it describes later phases, not today's behaviour.

**Status**: phase 1 is done; phase 2 has `tenbox close`, `tenbox pr`, `/tenbox-close` and
`tenbox merge-check`. See [Roadmap](#roadmap).

## How a task runs today

```
tenbox start TEN-301              worktree ~/wt/<project>/TEN-301, branch feat/TEN-301, .tenbox/task.md (a link to the task dir),
                                  claude --bg in the task worktree, started with /tenbox-plan TEN-301
  /tenbox-plan TEN-301            planner writes plan.md, parts, questions.md, plan.json you read it (tenbox plan show)
tenbox approve TEN-301            check plan.json, record the approval: the time and the sha of plan.json you approve
tenbox build TEN-301              starts claude --bg in the task worktree with /tenbox-build and the plan as JSON
tenbox attach TEN-301             open the newest background session of the task in this terminal
  /tenbox-build {...}             rounds of build + tenbox check (by the worker) → review;
                                  tenbox build done checks the end, and a ready-for-you end opens the draft PR
  review the diff by hand
tenbox pr TEN-301 [--ready] [--force] [--wait]
                                  push the branch, create or update the PR (by hand, or for --ready)
  merge on GitHub (squash) you merge
/tenbox-close TEN-301             in a claude session in the main checkout: one runner step, tenbox close TEN-301
  tenbox close TEN-301            pull the base in the main checkout, write stats.json in the task dir, stop the task's background sessions,
                                  remove worktree and local branch, delete the remote branch, set the tracker to done
```

`/tenbox-plan` and `/tenbox-build` run in a background `claude` session (`claude --bg`) in the
task worktree: `tenbox start` starts one with `/tenbox-plan`, and `tenbox build` starts a new
one with `/tenbox-build`. Both return at once. `--allowedTools Workflow` lets the session start
the workflow without a prompt. `tenbox attach <id>` opens the newest one; `claude agents` lists
them. `claude --bg` refuses a workspace that Claude Code does not trust; a task worktree of a
trusted repository is trusted. Both also pass a `Notification` hook for permission prompts
(`--settings`), so a session that waits for you sends the `blocked` notification. A headless `claude -p` run stops at the workflow approval. To send review feedback into a new build,
add `feedback` to the args that `tenbox build` sends:
`/tenbox-build { "task": "TEN-301", "parts": [...], "lenses": [...], "feedback": "..." }`.

The task kind (`docs`, `small`, `normal`, `large`; see [Task kinds](#task-kinds)) sets how deep
the build goes. The planner picks it, or `tenbox start --kind` sets it by hand.
`tenbox start TEN-301 --kind docs` writes a one-part plan itself and starts no planner, so
`tenbox approve` and `tenbox build` come next.

## The CLI: `tenbox`

TypeScript on Bun. Every command prints one JSON document on stdout; human text goes to
stderr. A failure prints `{ "ok": false, "error", "code" }` and exits 1, or 2 for a usage
error. `TENBOX_DEBUG=1` logs every spawned command and prints stacks. The flags, the input,
the output fields and an example of each command are in `tenbox help <command>`; this table
names the commands and keeps their behaviour.

| Command | Does |
|---|---|
| `tenbox help` | Without a command, prints the usage line of every command on stderr and `{ ok, commands }` on stdout; `tenbox help <command>` prints `{ ok, command, usage, help }` on stdout, and the same text on stderr: the flags and their meaning, the input shape, the output fields and one example. The texts live in `cli/commands/help.ts`; an unknown command is a usage error (exit 2). |
| `tenbox start` | Task worktree and branch from the base (with an `origin`, start first runs `git fetch origin <base>` and fast-forwards the local base to it, so the worktree starts at the remote base and a main checkout with the base checked out moves forward too; a failed fetch is one stderr line and the local base is kept), the task dir `~/.tenbox/<project id>/<id>/` with `task.md` (with the tracker's comments) and `task.json` from the tracker (or from `--title`), `parts/` and `rounds/`, `project.json` `{ id, name }` in the project folder, and `.tenbox` in the worktree as an absolute symlink to the task dir (kept when it exists, also a real `.tenbox/` directory of an older task), the manifest `setup` command, tracker status to in progress. Then, in the task worktree, `claude --bg --model <model> --add-dir <task dir> --settings <blocked hook JSON> -n <names.session> --allowedTools Workflow -- "/tenbox-plan <id>"`, so the plan starts at once and `.tenbox` needs no permission prompt; the `--settings` JSON holds the `blocked` hook (see `tenbox hook`). `claude` in the output holds `session` (the `-n` name) and `state`: `started`; `exists` when `claude agents` lists a background session in the task worktree (none is started); `skipped` with `--no-claude`; `unavailable` without `claude` in `PATH`. When `claude --bg` fails, such as on an untrusted workspace, start fails with `claude` (exit 1) and Claude Code's message. Sets `worktree.baseRef: head` in the main checkout's `.claude/settings.local.json`. Writes `id:` to the main checkout's `tenbox.yaml` when it is missing. Before it creates a new worktree (not when it reuses one), start looks for another run of the task: with an `origin` and without `--force`, when `git ls-remote` finds the task branch on `origin`, it fails with `task-in-progress` (exit 1), and `details` `{ branch, pr }` names the branch and the URL of its open PR (from `gh pr list --head <branch>`; null without one, or when `gh` cannot answer, with one stderr line); a failed `ls-remote` is one stderr line and the start goes on. `--force` starts anyway. Before it creates the worktree, start also checks that `tenbox.yaml` is committed on the base and has no local changes; otherwise it fails with `manifest-not-committed` (exit 1) and says to commit `tenbox.yaml` on the base, so a new id also needs a commit before the next start. `--kind` adds `kind` to a new `task.json` (an existing `task.json` is kept as it is), and `tenbox plan done` then saves that kind instead of the planner's; any other value than `docs`, `small`, `normal` or `large` gives `usage` (exit 2) before anything is made. `--kind docs` also writes the plan with no planner: `plan.md` (`# <id> · <title>` and the task description, or the title when it has none), `plan.json` (`kind: "docs"`, the title as `summary`, `estimated_lines: 0`, one `easy` part `01`, no examples, decisions, lenses or questions) and `parts/01-docs.md`, and starts no background session (`claude.state: skipped`); `tenbox approve` and `tenbox build` follow as for any plan. Safe to run twice |
| `tenbox queue` | Run in the project. Sets the tracker task to queued: it waits for a free slot and has no worktree or task dir yet; whoever keeps the queue runs it, and `tenbox start` later sets in progress. It changes no file. Prints `{ ok, task, tracker: { kind, status } }` with the real status name, or `skipped` when the tracker has no queued status (see [Tracker](#tracker)). Tracker `none` gives `no-tracker`, a tracker failure its own error (exit 1); without an id it is `usage` (exit 2) |
| `tenbox part done` | Checks the commit a worker returns for a part before its check. Exits 0 and prints `{ ok, task, part, commit }` (full sha) when the commit exists, is on `HEAD`, is after `--since` (default: the merge-base of `HEAD` and the manifest base), changes a file of the part's `files` list in `plan.json` (a part without `files` covers the whole worktree), and nothing in those files is staged or unstaged. Otherwise `part-not-committed` (exit 1, naming the file for a dirty one); a part not in `plan.json` gives `unknown-part`. `--group N` runs in the group worktree |
| `tenbox part reopen` | `tenbox part reopen <id> --part NN --accept "..."`: one more round on a part. Rewrites its part file in the task dir: `status: todo`, `- ...` after the last line of the `acceptance:` block (a new block before `result:` when the file has none), each `result:` line with text becomes a `history:` line, and one empty `result:` line ends the file. It also adds one decision line to `.tenbox/decisions.md`, as `tenbox decide` writes a note: part NN was reopened with the new acceptance line, and that line is final, so the worker builds it and returns no decision card when `plan.md` or `plan.json` do not name it. `plan.json` does not change, so the approval stays and the next `tenbox build` sends the part. Does not change `task.json`. A part with no part file gives `unknown-part` (exit 1); a missing `--part` or `--accept` gives `usage` (exit 2). Prints `{ ok, task, part, file }` |
| `tenbox worktree` | Makes the worktree of group `N` from `plan.json`, or finds it. Group 1 is the task worktree on the task branch. Group N > 1 gets `~/wt/<project>/<id>-N` on `<task branch>-N` (`feat/<id>-N`): a group with no `needs` starts from the manifest base; otherwise it starts from the branch of its first need and the branches of the other needs are merged in. `.tenbox` links to the task dir, `setup` runs, and `.tenbox/groups/N/group.json` `{ start }` keeps the start commit. Prints `{ ok, task, group, worktree, branch, created }`; a second run prints `created: false`. A group that `plan.json` does not list gives `unknown-group` (exit 1); a merge conflict gives `merge-conflict` (exit 1, with the files) and removes the worktree and branch again. When the group branch already exists without a worktree, it is reused with its commits and `group.json` `start` is the commit of the first need (or the base), so only its own commits are replayed later. A missing `--group` is a usage error (exit 2) |
| `tenbox check` | Runs the manifest checks of one tier (default `fast`) in the task worktree and keeps only new failures (see below). A check with a new failure runs once more; a new failure line that only one of the two runs has is `flaky`: it is listed in the check's `flaky` array (always present) and does not fail the check. With `--group N` (above 1) it runs in the worktree of group `N` (made when missing) and writes to `.tenbox/groups/N/rounds/R/`, with rounds counted per group; `--group 1` is the task. Writes `.tenbox/rounds/N/checks.json` (`checks-full.json` for `full`) and `checks/<name>.log`; without `--round`, `fast` takes the next free round and `full` the newest one (1 when there is none). The result has `tier`. `--tier full` with no `full` checks prints `ok: true` with `checks: []`; any other tier is a usage error (exit 2) |
| `tenbox approve` | Checks the plan as `tenbox plan done` does: no `.tenbox/plan.json` or no `.tenbox/plan.md` gives `no-plan` (exit 1); a `plan.json` that is not JSON or breaks the schema (also one written by hand) or a `plan.md` over 60 lines gives `bad-file` (exit 1, the message names the file and the issues); both write nothing. Writes `.tenbox/approved.json` `{ at, plan_sha }`: the ISO time and the SHA-256 hex of the `plan.json` text, so an edit of `plan.md` keeps the approval. A second run overwrites it. Prints `{ ok, task, file, at, plan_sha }`. `tenbox approved` reads it |
| `tenbox approved` | Checks the approval, as `tenbox build` does before it sends the build. Fails with `not-approved` (exit 1) when `.tenbox/approved.json` is missing, and with `plan-changed` (exit 1) when `plan.json` is missing or its SHA-256 differs from `plan_sha`; both errors name `tenbox approve <id>`. Prints `{ ok, task, file, at, plan_sha }` |
| `tenbox build` | Checks the approval as `tenbox approved` does (`not-approved`, `plan-changed`, exit 1), then reads `.tenbox/plan.json` (missing: `no-plan`, not valid: `bad-file`, exit 1) and runs `claude --bg` in the task worktree as `tenbox start` does (with the same `--settings` hook), with `/tenbox-build <args>`: `<args>` is one line of JSON, `{ task, kind, reviews, parts, lenses, groups }` with the `kind`, `parts`, `lenses` and `groups` of `plan.json` (no `groups` key when the plan has none), without the parts whose part file in `.tenbox/parts/` says `status: done`, the kind applied: `reviews` is the kind's review rounds, and `lenses` and each group recipe's `lenses` and `tier` are as the kind gives them (see [Task kinds](#task-kinds)); the recipe `model` and `effort` stay as the plan has them; an unapproved or changed plan starts nothing. When every part file says `status: done`, no part is left and it gives `nothing-to-build` (exit 1), naming `status: todo` and `tenbox build <id>`; no session starts and the `task.json` status and the tracker stay. It returns before the workflow ends. A background session of the task worktree that works (`state: working` in `claude agents --json`; a `blocked` session waits for a person, as a planner does after its plan, and does not count) gives `session-busy` (exit 1), naming `tenbox attach <id>`, and starts nothing. A failed `claude --bg` gives `claude` (exit 1) with Claude Code's message. Once `claude --bg` started, it sets the `task.json` status `building`, so `tenbox status` shows it while `/tenbox-build` runs; a refusal or a failed start keeps the status. It then sets the tracker task to in progress, so a new round after a review shows as work again: the tracker of the task worktree's manifest, as for the findings of `tenbox build done`; skipped (`status: "skipped"`) without `task.json` or with `tracker: "none"` in it; a failure, also a tracker without its key, is `failed: <reason>` and the build is still sent. Prints `{ ok, task, sent, tracker: { kind, status } }` |
| `tenbox attach` | Lists the sessions with `claude agents --json --cwd <task worktree>` and runs `claude attach <id>` in this terminal for the newest background session whose `cwd` is the task worktree. Prints `{ ok, task, session }` after you leave the session. Without one it fails with `no-session` (exit 1), naming `tenbox build <id>`. Tenbox stores no session id |
| `tenbox hook blocked` | Run by Claude Code, not by hand: the `Notification` hook (matcher `permission_prompt`) that `tenbox start` and `tenbox build` pass to `claude --bg` with `--settings`, so a session that waits on a permission prompt tells you. Reads the hook input JSON on stdin (`message`), finds the task worktree and sends one `blocked` notification. A `tenbox answer` resume passes no `--settings` (any other flag starts a copy of the session); the session keeps the hook it was started with. Always exits 0, so the hook never blocks the session; prints `{ ok, task, sent }`, with `sent: false` and one stderr line when stdin is not a JSON object with a text `message` or none, the task has no worktree or no line went out (no `notify.ntfy`). Any other name than `blocked` gives `usage` (exit 2) |
| `tenbox plan done` | Run by `/tenbox-plan` through the runner; by hand only when the plan was made without the workflow. Validates the planner result with zod and writes it to `.tenbox/plan.json`, then sends the `plan-ready` notification. A result that is not JSON, or has a wrong `estimated_lines` (a whole number), a part without `id`, a `difficulty` other than `easy` or `hard`, a `criteria` key in place of `examples`, an example whose `part` is not a plan part or whose `title`, `before` or `after` has the word `grep` (any case; the message names the text), a decision with fewer than 2 options or a `taken` that is not the number of one of them, or `groups` that break the group rules (see Task files, `plan.json`), or a `kind` other than `docs`, `small`, `normal` or `large`, gives `bad-input` (exit 1) and writes nothing; a result without `kind` is saved with `kind: "normal"`, and a `kind` in `task.json` (from `tenbox start --kind`) is saved instead of the result's. It also reads `.tenbox/plan.md`: missing gives `no-plan` (exit 1), more than 60 lines gives `bad-file` (exit 1, the message gives the count and the limit), and both write nothing. A missing `--json` or another sub-command gives `usage` (exit 2). Prints `{ ok, task, file, stale_parts }`: `stale_parts` lists `{ part, file, reason }` for each part file of `.tenbox/parts/` that does not match the saved plan, in part id order, with one stderr line each: `not in the plan` (a part file whose id is not a plan part), `no part file` (a plan part with no part file, `file` null), `files differ` (the `files:` line, split on commas, is not the same set as the part's `files`); empty when all match. The plan is saved in every case |
| `tenbox plan show` | Prints the plan of `.tenbox/plan.json` the same way for every task: `{ ok, task, file, estimated_lines, parts, groups, examples, decisions, questions }` on stdout, and as text on stderr: the estimated lines, each part with its difficulty, each group as `<id> · <name> · parts <ids>` with `· needs <ids>` when it has needs (`groups` is null and the text says `none` for a plan without groups, which is one PR), each example with its `before` and `after`, each decision with its numbered options, the taken one marked `* N. <option> (taken)`, and its reason, then the questions. The questions come from `.tenbox/questions.md`, not from `plan.json`: `questions` is `[{ number, kind, blocking, open, text }]`, one item per line that starts with `- [ ] ` or `- [x] `, `number` counted from 1 in file order over both, `kind` the last `## <kind>` heading above the line (null without one), `open` false for a ticked line, and `text` the line without its checkbox and `(blocking) `; the text shows each one as `<number>. [<kind>] (blocking) <text>`, with `[x] ` after the number for a ticked line. A missing `questions.md` shows no question. `tenbox decide` takes this `number` or this `text` as `question`. No valid `plan.json` gives `no-plan` (exit 1) |
| `tenbox build done` | Run by `/tenbox-build` through the runner at every end status. Validates the build result with zod. A `ready-for-you` result is then checked before anything is written, for each group of `plan.json` (a plan without groups is group 1): the `checks.json` of the group's newest round that has one (a stopped check leaves its round without one) must have run at the group worktree's `HEAD` (else `checks-stale`, exit 1, as `tenbox pr` gives it) and have `ok: true` (else `check-failed`, exit 1, with the check summary in the message). Then it runs the `full` tier as `tenbox check <id> --group N --tier full` does, in the current round (`rounds/N/checks-full.json`), for each group whose recipe `tier`, with the build's kind applied, is `full` (a plan without groups is group 1 at tier `full`, unless its kind forces `fast`); new failures give `check-failed` (exit 1). A `check-failed` error has `details: { group, tier }`. The build's kind is the result's own `kind`, else the `kind` of `plan.json`, else `normal`; so a `small` or `docs` build runs no `full` tier and a `large` one always does. Then the diff must fit the limits of that kind: for each group of `plan.json` (group 1 without groups) it counts `git diff --numstat <base>...<group branch>` (the task branch for group 1, `<task branch>-N` above; a branch that does not exist counts nothing), without generated files (as `code` in `stats.json`), a path in two groups once, at its largest change. A diff over the limits gives `kind-raised` (exit 1) and writes nothing: the message names the files, the changed lines, the old kind and the new one: the smallest kind above the old one whose limits the diff fits; and `details: { kind, lenses, reviews }` holds that kind, its lenses over the plan's `lenses` and its review rounds. A result with that `kind` is then accepted. `needs-you` and `failed` results skip these checks. Then each item of `findings` (a reviewer's bug or gap outside the task, a task draft `{ title, why, what, done }`; missing means none) is opened as a task in the tracker of the task worktree's manifest (its own `tenbox.yaml`, as `tenbox check` reads it), as `tenbox task new` does: the house body, the line `Found by task <id>.` at the end, the label `agent`, and an open task with the same title is reused; with tracker `none` nothing is opened; a tracker failure is one `warning:` line on stderr and the build done goes on. The result is then written to `.tenbox/build.json` with `kind`, the build's kind, and each finding with its `task: { id, url }`, null when none was opened; each of its `proofs` is appended to `.tenbox/proofs.json` unless that file already holds one with the same part, file, test and failure (the workflow sends every round's proofs at each end status). A second run keeps the earlier `unproven` items first; `status`, `round`, `attention`, `nice_to_have` and `findings` are the new ones. A result that is not JSON, or has an unknown `status` or `kind`, a `round` that is not a whole number, a proof with a blank field, or a decision card whose `recommended` is not the number of one of its options or whose `kind` is missing or unknown, gives `bad-input` (exit 1) and writes nothing; a missing `--json` gives `usage` (exit 2). A result with a decision card (`decision: { title, options, recommended, reason, auto, kind }`, `recommended` counted from 1; `kind` is `migration`, `data-delete`, `feature-delete`, `contract`, `paid-service`, `locked-file`, `scope` or `other`) gets `deadline`: the call time + 30 minutes when `auto` is true and the kind is not never-auto, else `null`. A `needs-you` card with `auto: true` and a kind other than the six never-auto ones (all but `scope` and `other`) also starts `tenbox answer <id> --auto` in the background (tenbox itself, in its own process group, with its output appended to `.tenbox/auto-answer.log`), so the card gets an answer with no human command. A written `ready-for-you` result then opens the PR as `tenbox pr <id>` does with no flag (a draft, no CI wait) and adds its JSON as `pr`; when that throws, `pr` is `{ ok: false, error }` and the exit code stays 0. After the PR step it sets the tracker task to review, as `tenbox build` sets in progress, and adds `tracker: { kind, status }`. Prints `{ ok, task, file, findings }`, and `pr` and `tracker` for `ready-for-you` |
| `tenbox answer` | Answers the decision card of a `needs-you` `build.json` with option `n` (counted from 1) and resumes the build run that asked it. Appends the note `- <card title> Answer: <n>. <option>` to `.tenbox/decisions.md`, writes `answered: { option, at, auto: false }` into `build.json`, finds the newest `tenbox-build` run of the task worktree in Claude Code's session files (`<run id>.json`: run id, script path, args; the session folder is the full session id), stops the task's background sessions, waits until their processes (the `pid` of `claude agents --json`) have ended (`claude stop` returns before the process ends; a resume before then starts a copy under a new id, and that copy cannot find the run's journal, so every agent of the run would run again), and runs `claude --bg --resume <session id> -- "<prompt>"` in the task worktree, with no other flag (any other flag also starts a copy): the session that ran the workflow goes on under its own id. The prompt asks for the Workflow tool with that script path, `resumeFromRunId` and the run's args plus `answer: { round, part, option, text }`; args that are JSON text, as `tenbox build` sends them, are parsed back into their object first, so the run keeps its `parts`, `lenses` and `groups`. Fails, before it writes anything, with `no-decision` (exit 1) when `build.json` has no `needs-you` card, `answered` (exit 1) when the card is answered, `no-run` (exit 1) without a `tenbox-build` run, and `usage` (exit 2) when `n` is not the number of an option. When `claude` fails, or the process of a stopped session still runs after 10 s (`claude` or `no-command`, exit 1), `build.json` is written back without `answered`, so the same answer can be given again; `decisions.md` keeps one line for it. Run from one of the task's background sessions (its `CLAUDE_CODE_SESSION_ID` is the `sessionId` of a session `claude agents --json` lists in the task worktree, as when a person answers through Remote Control), the stop would end the command too: after the same checks it starts `tenbox answer <id> <n>` in its own process group, without `CLAUDE_CODE_SESSION_ID`, with its output appended to `.tenbox/answer.log`, and returns at once; that run does all of the above. Prints `{ ok, task, option, run, session }`, and `log`, the path of `answer.log`, when it started that run |
| `tenbox answer --auto` | Automatic continue, started by `tenbox build done`. Reads `build.json`; when it holds an unanswered `needs-you` card with `auto: true`, it waits until the card's `deadline`, looking at `build.json` once a second, then answers with the recommended option as `tenbox answer <id> <n>` does: the `decisions.md` note ends with `(auto: no answer in 30 min)` and `answered` has `auto: true`. Prints `{ ok, task, state: "answered", option, run, session }`. A card with `auto: false`, a card of a never-auto kind, an answered card (also one a person answers while it waits) and a card that a newer `tenbox build done` replaced (its `deadline` differs) change nothing: it prints `{ ok, task, state: "skipped" }`. Never auto: a card of kind `migration`, `data-delete`, `feature-delete`, `contract`, `paid-service` or `locked-file` (`NEVER_AUTO` in `domain/cards.ts`) gets `deadline: null` and no timer, and `--auto` skips it even with `auto: true`; the worker picks the kind (`agents/worker.md`) |
| `tenbox wait` | `plan` and `build`: checks once a second for `.tenbox/plan.json` or `.tenbox/build.json` and prints `{ ok, task, file }` as soon as it exists (an earlier `plan.json` or `build.json` makes it return at once); while the `task.json` status is `building` (from `tenbox build`, `decide` or `answer` until `build done`), the `build.json` of the build before does not count, so `--for build` after a new build waits for its result. `round`: notes the `rounds/N/checks.json` files and the text of `build.json` at the start and returns at the first change: `{ ok, task, round, status, file }` with `status: "running"` and the new round's `checks.json`, or the `status` and `round` of a `build.json` that is written or changed. `decision`: returns `{ ok, task, event: "decision", file, decision }` when `build.json` is `needs-you` with a card that has no `answered` (checked at once and then every second; an answered card does not count, so the wait is safe after `tenbox answer`, and neither does any card while the status is `building`). `any`: returns the same shape with `event` `decision` (as above), `build` (a `build.json` written after the command started) or `plan` (a `plan.json` written after the command started), in that order when several are true; `decision` is the card or `null`. It uses the file modification time like `round`, so a `plan.json` or `build.json` from before the command does not end it. Fails with `wait-timeout` (exit 1) after `--timeout` seconds; a missing or other `--for` gives `usage` (exit 2) |
| `tenbox pr` | `tenbox build done` opens the draft PR of a ready build the same way; run it by hand for `--ready` or after a failed run. Opens one PR per group of `plan.json` (a plan without groups is one group 1). A group whose needs are all merged (each need's PR is `MERGED`) is pushed, then its PR is created (a draft unless `--ready`) or updated; a group with needs and no PR yet waited for them: it is first rebased onto the base (`git fetch`, then `git rebase --onto origin/<base> <start>` with `start` from `.tenbox/groups/<N>/group.json`, which then holds the new base), so only its own commits stay; without `--force` its fast tier then runs again at the new `HEAD`, as `tenbox check <id> --group N` does (a new round; new failures do not stop the push, the PR body shows them), so a next `tenbox pr --ready` needs no hand-run `tenbox check`; it is pushed with `--force-with-lease`; a conflict aborts the rebase, gives the group `conflict` with `files`, pushes nothing for it, and the other groups go on; any other group is first merged with `origin/<base>` in memory (`git fetch`, then `git merge-tree --write-tree`; skipped when `origin/<base>` does not exist): a conflict gives the group `conflict` with `files` and its PR, if it has one, and pushes nothing for it; the next step is a merge of `origin/<base>` into the branch with a merge commit (no force push), `tenbox check`, then `tenbox pr` again; a group with an unmerged need gets `waiting` and nothing is pushed for it; a group whose own PR is already `MERGED` gets `merged` and is left alone. A dirty worktree or a branch with no commits ahead of the base is refused. A group whose newest `checks.json` (of the newest round that has one) was not run at the group worktree's `HEAD` (or that has none) is refused with `checks-stale` (exit 1, nothing pushed; the message says to run `tenbox check`); `--force` skips that guard. `--wait` then polls `gh pr checks <number>` every 10 s for each group that was created or updated, up to 30 minutes, and adds `ci: { state, checks: [{ name, state, time, url }] }` to it; `state` is `pass`, `fail` or `none` (no checks reported 2 minutes after the push). A `fail` or `cancel` check exits 1 with `ci-failed`, and a CI still pending at the deadline with `ci-timeout`; both carry the whole result in `details`. Without `--wait` there is no `ci` key and no `gh pr checks` call. The body starts with the line `tenbox: <id> group <N>`, then `## Checks` with the summary of each tier that ran in the group's newest round with a `checks.json`, under `### fast tier` and, when `checks-full.json` is in that round, `### full tier` (with its new failures), and the whole `plan.md` folded. The title is `<id> · <group name>` (a plan without groups: `<id> · <title>` from `task.json`). A PR is found by that body line (`gh pr list --state all --search`, then an exact line match), else by its branch, which finds PRs opened before the line. A `gh pr list` output that does not fit its shape gives `gh` (exit 1) with the issues, for example `gh pr list failed: output does not fit: 0.isDraft: ...`. Prints `{ ok, task, groups: [{ group, branch, state, pr }] }`; `state` is `created`, `updated`, `waiting`, `merged` or `conflict` (with `files`, the conflicted files), and `pr` is `{ number, url, draft }`, or null for a waiting or conflicted group with no PR. Tenbox never merges a PR: a person merges it on GitHub |
| `tenbox merge-check` | Run in the project. Runs `git fetch origin`, lists the open PRs into the base whose head branch fits `names.branch` (others are left out), and merges `origin/<branch>` of each onto `origin/<base>` in a temporary detached worktree, lowest PR number first. Then it runs `setup` and every check of both tiers there and judges them as `tenbox check` does: only new failures against the baseline fail a check (it writes no log files). The worktree is removed on every way out. With no open task PR it prints `ok: true` with empty lists. A failed `setup` gives `setup` (exit 1). A conflict gives `merge-conflict` (exit 1) with `{ base, prs, order, conflict: { branch, files } }` in `details`; a new failure gives `new-failures` (exit 1) with the whole result in `details`. Prints `{ ok, base: { ref, sha }, prs: [{ number, branch }], order, checks, summary }`. It never pushes and never moves a local branch |
| `tenbox close` | Refuses, before it changes anything: a run from inside the task worktree (`in-task-worktree`, also with `--force`, because the close removes that directory), a dirty worktree (`dirty`), a branch not merged into the base (`unmerged`) and a PR merged as a merge commit whose branch head is not in `origin/<base>` (`merge-commit`: the merge commit has two parents, a squash or rebase merge has one; after a `git fetch origin` in the main checkout the head must be an ancestor of `origin/<base>`, and a failed fetch keeps the refusal; the message says why and that the work must be pushed to the base or the fetch fixed; an accepted merge commit is closed like a squash merge, with the pull and the remote branch delete). `--force` skips the last three. Before the merged check of the task branch and of each group branch, the close runs `git fetch origin <branch>` (in its worktree, else in the main checkout) and fast-forwards the local branch when it is behind, so a PR head pushed from another clone, as from the box, counts as the branch head; a branch that is ahead or has diverged stays as it is, and a failed fetch (the remote branch is gone) is one stderr line and the close goes on. "Merged" comes from `gh pr view`: the PR is `MERGED` and the branch head is the PR head; an `OPEN` or `CLOSED` PR is not merged. Without a PR, or without `gh`, a test merge into the base decides, and one stderr line says so. When either would say `unmerged`, the close runs `git fetch origin` and a branch head that is an ancestor of `origin/<base>` still counts as merged, whatever `gh` said or the test merge did: with a `MERGED` PR as a GitHub merge (pull and remote branch delete), otherwise as a git merge (neither); a failed fetch or a head not in `origin/<base>` keeps `unmerged`. When GitHub says `MERGED` (not with `--force`, not after the test merge), the close also runs `git pull --ff-only origin <base>` in the main checkout before the stats, only when that checkout has the base checked out (`pull: { base, state }`: `pulled`, `skipped` or `failed: <reason>`; a failed pull does not stop the close), and after the tracker step deletes `origin/<branch>` (`remote_branch: { name, state }`: `deleted`, `skipped` when it is already gone or not asked, or `failed: <reason>`). Writes `stats.json` in the task dir (it stays, with the other task files; `stats: { path, state, record }` prints it, `record` the written content and null when the stats are skipped or failed), stops every background session of the task worktree with `claude stop`, not `claude rm`, so the transcripts stay for `tenbox stats` (`session: { state }`: `stopped`, `skipped` with no session, no worktree or no `claude` in `PATH`; a session that `claude agents --json` lists without a `pid`, as after a reboot of the machine, has no process any more and counts as no session for `close`, `build` and `attach`, or `failed: <reason>` when `claude` fails; the close goes on), removes the worktree and the local branch, sets the tracker to done, then posts one close comment to the task: `<total> min, <k>k tokens, <n> rounds` (total minutes, output tokens of all agents in thousands, number of rounds), then `, opened <url>, <url>` when the build opened tasks for its findings (`findings` of `stats.json`); `comment: { state }` with `posted`, `skipped` (tracker `none`, or no `stats.json` written) or `failed: <reason>`; a failed comment does not stop the close. The `Tracker` port has `comment` (Linear `commentCreate`, ClickUp `POST /task/{id}/comment`). A step with nothing to do is skipped. For a task with groups in `plan.json`, the close finds the PR of each group above 1 by its `tenbox: <id> group N` body line (else by the branch name), so a head branch that does not fit `names.branch` is still found; every group must be merged at its branch head and have a clean worktree, else `unmerged` (exit 1) names the first group that is not (`group N (<branch>)`) and nothing changes. It then removes each group worktree and its local branch before the task worktree, and deletes each group's remote branch like the task's (`groups: [{ group, worktree, branch, remote_branch }]`, only for a task with groups). `--force` skips these checks too. A `proofs.json` that is not a JSON array of valid proofs gives `bad-file` before anything changes |
| `tenbox proof` | For a person who works by hand, outside `/tenbox-build`, and wants that proof counted at close; workers return proofs in their result and do not call it. Appends one proof `{ part, file, test, failure }`, each field trimmed, to `.tenbox/proofs.json`. Every flag is required and not blank (else `usage`, exit 2); `--part` must be the `NN` of a file in `.tenbox/parts/` (else `unknown-part`, exit 1); a `proofs.json` that is not a JSON array of valid proofs gives `bad-file`, exit 1, and nothing is written |
| `tenbox decide` | Records the answers to a plan. Each item with a `question` appends `- <question line without its checkbox and "(blocking) ">` and `  Answer: <answer>` to `.tenbox/decisions.md` (created when missing) and ticks that line of `.tenbox/questions.md` (`- [ ] ` becomes `- [x] `). An item without `question` is a note: it appends `- <answer>`. A `question` is a text or a whole number from 1. A text matches the one line that starts with `- [ ] ` or `- [x] ` and contains the trimmed text; a number picks that line of the same lines counted from 1 in file order, ticked or open, the `number` of `tenbox plan show`, so a number does not move when another question is answered. No line or more than one, or a number past the last line, gives `unknown-question` (exit 1) and nothing is written, also when other items are valid; its message names each open question as `<number>. <text>` and its `details` are `[{ number, text }]`. A number below 1 or not whole gives `bad-input`. An item `{ decision, taken }` overrides the option a plan decision took: `decision` matches the one decision of `plan.json` whose `title` contains the trimmed text (no decision or more than one gives `unknown-decision`, exit 1), `taken` counts from 1 (not the number of one of its options: `bad-input`, exit 1); it sets `taken` in `plan.json` and appends the note `- <title>: <option text>`. When `approved.json` exists, the approval is written again with the new `plan.json` sha, because the person who decides is the one who approves; an unapproved plan stays unapproved. Every refusal comes before anything is written. An entry already in `decisions.md` is not added again, so a second run changes no byte. A `--json` that is not an array of items with a non-blank `answer` gives `bad-input` (exit 1); a missing `--json` gives `usage` (exit 2); these start no build. After the answers are written it sends the build like `tenbox build` (`claude --bg` with `/tenbox-build <args>` in the task worktree), so one command per decision is enough; `--no-build` only records. The errors of `tenbox build` (`not-approved`, `plan-changed`, `no-plan`, `nothing-to-build`, `session-busy`, `claude`) come after the answers are written (exit 1), and a rerun adds nothing and sends the build again. Prints `{ ok, task, file, added, ticked, sent }`, with `file` the path of `decisions.md` and `sent` the prompt (`/tenbox-build <args>`; no `sent` key with `--no-build`) |
| `tenbox machine run` | Runs one tenbox command of the task as a Job on the cluster. It reads the manifest of the project of the current directory and the kubeconfig (`$KUBECONFIG`, else `~/.kube/config`; missing: `no-kubeconfig`, a file without a usable current context: `kubeconfig`, exit 1; neither names a credential): the server and the CA of the current context's cluster, and its user's `token` (sent as `Authorization: Bearer`) or else its `client-certificate-data` and `client-key-data` (sent as the TLS client certificate). It reads `job.yaml` and `pvc.yaml` from the `machine.template` directory (default `~/tenyard/task`; a missing or non-mapping file is `template`, exit 1) and fills the `__X__` fields of every string value: `__NAME__` (the id in lower case, `_` as `-`), `__TASK__`, `__RUN__` (`MMDD-HHMMSS`, UTC), `__PROJECT__`, `__PROJECT_ID__` (the `id` of the project's `tenbox.yaml`; without one the command refuses with `no-project-id`, exit 1), `__REPO__` (the origin URL of the main checkout without a user or token), `__BASE__` (`base` of the manifest, default `main`; tenyard `task/job.yaml` needs `- { name: TENBOX_BASE, value: "__BASE__" }`, and the box then clones with `--branch`, or on a kept volume fetches and checks out the base, and exits 1 with a log line when `tenbox.yaml` is not tracked there; without `TENBOX_BASE` it clones the default branch), `__GIT_NAME__` and `__GIT_EMAIL__` (the commit author of the box: the `name`, else the `login`, of `gh api user` on this computer, and `<id>+<login>@users.noreply.github.com`; a `gh` that cannot answer is `gh`, exit 1, before any request; the box sets them as `user.name` and `user.email` when the Job passes them as `TENBOX_GIT_NAME` and `TENBOX_GIT_EMAIL`, else it asks `gh api user` with its token), `__IMAGE__` (`ghcr.io/enojen/tenbox-box:latest`), `__ENV__` (`machine.env` of the manifest as one JSON object over the env of a build's services, `{}` without either; the box passes each key to the command as a variable), `__CLASS__`, `__CPU__` and `__MEMORY__` (the resource class and its `cpu` and `memory` from `classes.yaml` in the same directory, which gives no CPU limit: `machine.plan_class` for `start` (`plan`, `build` or `heavy`, default `plan`), `plan` for `close`, `machine.class` for `build`, `check`, `decide` and `answer`, which run tests or send the build, default `build`; `plan` for the others; a missing or broken `classes.yaml`, a class with any other key such as `cpu_limit`, or a class it lacks is `template`, exit 1), `__COMMAND__` (the command name alone, `build` or `plan`: no flags, no id; a pod label value) and `__CMD__` (the words after `--`, each one quoted for the shell when it holds more than letters, digits and `@%+=:,./-`, because the box runs it with `bash -c`). A `build`, `check`, `decide` or `answer` Job then gets the services of `machine.services`: each one is `services/<name>.yaml` in the same directory, a strategic merge patch of the Job whose sidecars (`initContainers`) and volumes tenbox adds as `kubectl patch --type strategic` does (an entry replaces the one of its name), and whose `box` container env goes to `__ENV__`, because the box gives its command no other variable; a missing file, a file with any other key or an env from a Secret is `template`, exit 1; the others get no service. All of this comes before any request. It then lists the Jobs of namespace `tenbox` with the label `task=<id>` and refuses with `machine-busy` (exit 1, naming the Jobs) while one has `status.active > 0`, as two commands must not share the task volume; else it writes the project Secret `project-<project id>` (a POST, and on 409 a PUT that replaces it whole) with `tracker_api_key`, the tracker key this computer uses for the project (`tracker.api_key` of the manifest with its local layers, else `LINEAR_API_KEY` or `CLICKUP_API_KEY` by the tracker kind; left out for tracker `none` or when neither is set) and `ntfy_url`, `notify.ntfy` (left out when unset), then posts the PVC (an answer 409, the volume exists, keeps it) and the Job, and prints `{ ok, task, cmd, url }` with `url` the API URL of the Job, `<server>/apis/batch/v1/namespaces/tenbox/jobs/<name>`. A failed request is `kubernetes` (exit 1) with the HTTP status and the start of the answer, never the request. Only these commands of the same id are allowed, after `--`, each with its own flags: `start [--title X] [--force]`, `build`, `close [--force]`, `approve`, `status`, `plan show` (`cmd` is `plan`), `pr [--ready] [--force] [--wait]`, `check [--group N] [--tier T]`, `decide [--json J] [--no-build]` and `answer <n>`; `--json` is one word, quoted for the shell, so a quote or `$(x)` in it reaches the box unchanged. Anything else (another id or command, no `--`, an unknown flag, a value flag without its value, `answer` without exactly one number, `plan` without `show`) is `usage` (exit 2) before any request; the box's own tenbox checks the values. Before the cluster it reads `refreshTokenExpiresAt` in `<claude dir>/.credentials.json` (the expiry only, never a token): a missing file is `no-login` and an expired refresh token is `login-expired`, both exit 1 and asking for `/login` on this computer, and the cluster is not called. On macOS the login lives in the Keychain, so there is no file and the command refuses with `no-login` `--wait [--timeout S]` (before `--`; a `--wait` after `--` stays a flag of the command in the box, as `pr --wait`) waits instead of refusing and then for the Job's end, under one deadline of `--timeout` seconds (default 600) for both waits: while a Job of the task is active it polls the Job list every 2 s instead of `machine-busy`, checks once more and posts; after the post it polls the Job list every 2 s until the posted Job has `status.succeeded > 0` or `status.failed > 0`, then reads the whole log of its newest pod once (no follow) and prints `{ ok, task, cmd, job, status, reason, output, log }`: `job` the Job name, `status` `success`, `reason` as in `machine logs` (`OOMKilled` from the pod or the last boot line, else the terminated reason of the pod, null without one), `output` the last top-level JSON object of the log (from a `{` line up to the next `}` line at column 0, as tenbox prints its JSON; null when there is none), `log` the last 40 lines of the log as one string. A failed Job is `machine-failed` (exit 1) with these fields, `status` `failure`, in `details`; a Job gone from the list during the wait (`tenbox machine stop`, or gone 10 minutes after it ended) counts as failed with `reason` and `output` null and `log` empty. Past the deadline it is `machine-timeout` (exit 1) naming the Jobs it waited for; nothing is deleted and the Job keeps running. `--wait` or `--timeout` with `ls`, `logs`, `stop` or `rm`, and `--timeout` without `--wait`, are `usage` (exit 2) before any request |
| `tenbox machine stop` | Ends a stuck run: reads the kubeconfig as `run` does, lists the Jobs of namespace `tenbox` with the label `task=<id>` and sends one `DELETE jobs/<name>?propagationPolicy=Background` for each with `status.active > 0` (a finished Job is left for `ls`), so the pod is killed and a new `run` is not `machine-busy`. Prints `{ ok, task, stopped: [<Job name>] }`, the Jobs it deleted: empty with no active Job, and a Job that ended and is gone before its DELETE (404) is left out, not an error. It needs no manifest, login or project id, and sends no PVC or Secret request. Without a kubeconfig it is `no-kubeconfig`, a failed request `kubernetes` (exit 1); without an id or with an extra word it is `usage` (exit 2) |
| `tenbox machine rm` | Deletes the volume `task-<name>` of the task (`<name>` as `__NAME__` above) in namespace `tenbox`: it lists the Jobs with the label `task=<id>`, refuses with `machine-busy` (exit 1, naming the Jobs, no DELETE) while one has `status.active > 0`, else sends one `DELETE` to `/api/v1/namespaces/tenbox/persistentvolumeclaims/task-<name>` and prints `{ ok, task, volume: { name, state } }` with `state` `deleted`, or `missing` when the answer is 404 (a second `rm` is safe). It needs only the kubeconfig: no manifest, no login, no template. Without an id or with an extra word it is `usage` (exit 2). It does not need a finished close Job (Jobs are gone 10 minutes after they end), so run it only after `tenbox machine ls` shows the close Job ended: deleting a volume cannot be undone. `tenbox close` never runs it; the server's volume watch deletes a closed task's volume itself after the grace period (see `server/`). Whether the Hetzner volume goes with the claim depends on the reclaim policy of the PV (`Delete` for StorageClass `hcloud-volumes`); tenbox does not touch PVs |
| `tenbox machine ls` | Prints `{ ok, runs: [{ id, title, status, conclusion, reason, url, created }] }`: the Jobs of namespace `tenbox` with the label `app=tenyard`, `id` the Job name, `title` its `TENBOX_CMD`, `status` `completed` with `conclusion` `success` (`status.succeeded > 0`) or `failure` (`status.failed > 0`), else `in_progress` with `conclusion` null, `reason` the terminated reason of the box container of the newest pod of a failed Job (`status.containerStatuses[].state.terminated.reason`, e.g. `OOMKilled`; one pod request per ended Job), else `OOMKilled` when the last log line of that pod (`tenbox-boot: ... oom_kill <n>`, from the cgroup `memory.events`) has `oom_kill` above 0, else null, `url` the API URL of the Job, `created` its `creationTimestamp` |
| `tenbox machine logs` | Writes the pod log of the task's newest Job (the latest `creationTimestamp` among the Jobs of namespace `tenbox` labeled `task=<id>`) to stderr, read from the Kubernetes API (`GET .../pods?labelSelector=job-name=<job>`, then `.../pods/<pod>/log`; the newest pod), and prints `{ ok, task, job, status, reason }` on stdout, `reason` as in `machine ls` (`OOMKilled` when the last boot log line has `oom_kill` above 0, else the terminated reason of the pod, null without one), `status` `success` (`status.succeeded > 0`), `failure` (`status.failed > 0`) or `in_progress`, read from the Job after the log ends. `--follow` asks for `follow=true`, ends when the stream ends, and polls every 2 s until a pod that has not started yet runs; without it a pod that waits to start is the `kubernetes` error with the answer of the API. A task with no Job is `no-machine-run` (exit 1) and asks for no pod or log; a failed request is `kubernetes` (exit 1) with the HTTP status, never the request or a token; no id or another word is `usage` (exit 2) |
| `tenbox stats` | Prints `{ ok, task, source, runs, rounds, roles, models }`: minutes and tokens per round (`{ round, minutes, calls, input, output, cache_write, cache_read }`), calls and tokens per role and per model. `source` is `stats.json` when the task dir has a `stats.json` of schema 5 to 7 (after `tenbox close`), else `sessions`: the `wf_*.json` run files and the `agent-<agentId>.jsonl` transcripts in Claude Code's session files for the task worktree. A run file with no `workflow_agent` entries (Claude Code 2.1.303 writes none) gets its agents the same way, from its run dir, with `finished: true`; `tokens` and `tool_calls` are then null. A run with no run file (its session ended before the run did) is counted too: its agents come from `journal.jsonl` (one per `started` line), `agent-<agentId>.meta.json` (role) and the transcript (model, first and last timestamp as start and length; no phase, tokens or tool calls), its workflow from the script name in `workflows/scripts/`; a run with no script or no timestamp is skipped. `runs` lists the runs oldest first as `{ workflow, started, finished }`, `finished: false` for such a run; from a `stats.json` it is the `runs` saved by `tenbox close`, `null` for schema 5, which has none. A `calls` is one assistant message id; a message on several lines counts once, with the tokens of its last line. `round` comes from the agent label `round N: ...` and counts across the build runs in start order (the second run's `round 1` is round 4 after a run of three rounds); agents with no round label (plan, approval, record build) have `round: null`, listed last. A round's minutes run from its first agent start to its last agent end. Without `stats.json` and without session files it fails with `no-stats`; with only a `stats.json` of an older schema (4 or less, no token numbers) it fails with `old-stats`. The transcript format is not a public API; only `cli/infra/claude/sessionFiles.ts` and `transcripts.ts` read it |
| `tenbox status` | Where one task stands, read from its files, its background session and its PR. Prints `{ ok, task, title, status, round, approved, parts, session, pr, checks, reason }`. `status`: the `status` of `.tenbox/task.json` (`started`, `plan-ready`, `approved`, `building`, the `build.json` status, `closed`; see `task.json` below), null without the file. `round`: the newest `rounds/N`, else the `round` of `build.json`, else `null`. `parts`: `{ todo, doing, done, blocked }`, counted from the `status:` line of each part file (a missing or other value counts as `todo`). `session`: `{ state }`, the `state` of the newest background session of the task worktree in `claude agents --json` (`working`, `blocked`, `done`), `none` without one, `unavailable` without `claude` in `PATH`, or `failed: <reason>`. `pr`: `{ number, url, draft }` or `null`, also when `gh` is missing or fails (one stderr line). `checks`: `{ round, ok, summary }` of the newest round that has a `checks.json`, else `null`; a `checks.json` that is not valid gives `bad-file` (exit 1). `reason`: why the build stopped, when `status` is `failed` or `needs-you` and `.tenbox/build.json` exists, else `null`: `{ feedback, attention, findings, decision, parts }`, where `feedback` is the last round's feedback of `build.json` (null without one), `attention` and `findings` are those of `build.json`, `decision` its decision card (null without one), and `parts` lists each part file that does not say `status: done` as `{ part, status, result }`, `result` the text of its `result:` line or null. So `tenbox machine run <id> -- tenbox status <id>` shows why a build on the cluster failed. A task with no worktree gives `no-worktree` (exit 1) |
| `tenbox list` | Run in the project. Prints `{ ok, tasks }`: the status report of `tenbox status` for every task worktree `~/wt/<project>/<id>` that has a `.tenbox` directory, ordered by id. `main`, the group worktrees (`<id>-N` next to `<id>`) and every name that is not a task id (a file such as `1-a.ci.log`, a folder such as `lib-1.2.3`) are left out. A task whose report fails (a `bad-file`, say) gives `{ task, error, code }` in its place, as a failed command prints it, and the list goes on; `tenbox status` of that task still fails. Also one line per task on stderr: `<id> · <status> · round <n or -> · parts <done>/<all> · session <state> · PR <#n or ->`, or `<id> · <code> · <error>` for a failed one. With no task worktree it prints `tasks: []`. It asks `gh` once per task, all tasks at the same time, and `claude agents --json --cwd ~/wt/<project>` once for all tasks |
| `tenbox task new` | Run in the project. The tracker comes from the manifest of the checkout it runs in: in a task worktree that worktree's `tenbox.yaml` with the local layers, as `tenbox check` reads it; in the main checkout its own. Writes one task in the project's tracker with the house body, the three sections `**Why**`, `**What**` and `**Done when**`, and prints `{ ok, task, url, created }`. Before it writes, it looks for an open task with exactly the title (ignoring case) and, when one exists, prints that one with `created: false` and writes nothing. A missing or empty section, or a `--json` that is not JSON, is `bad-input` (exit 1) before any request. `--label` (repeatable, or `labels` in the JSON) adds labels; inside a Claude Code session (`CLAUDECODE` is set) the task gets the label `agent` too, so a person triages it. A label the tracker lacks is created (GitHub: `gh label create`; Linear: in the team; ClickUp tags need no step). `--list <id>` opens the task in another place than the manifest's: a ClickUp list id instead of `tracker.list`, a Linear team key instead of `tracker.team`; `--parent <id>` opens it as a subtask (ClickUp, in the parent's list) or sub-issue (Linear) of that task; the search for an open task with the title looks in that same place. GitHub Issues has neither and refuses both with `tracker-unsupported` (exit 1) before any request. Without a tracker it refuses with `no-tracker`. Where each tracker writes is under Tracker |
| `tenbox report` | For a bug or a missing piece of Tenbox itself, found while working in any project: the same draft as `tenbox task new`, written as a GitHub issue of `enojen/tenbox` (`--repo tenyard`: `enojen/tenyard`, for the cluster, the box and the Jobs) through `gh` and its login, whatever the project's tracker is, with the same duplicate check and the same `agent` label. The label is `bug` unless `--label` names a kind. The body ends with `Found by task <id> on tenbox <commit>.` (the id from `.tenbox/task.json` of the worktree the command runs in, `Found on tenbox <commit>.` outside one; the commit is the head of the tenbox checkout that runs) and holds nothing else from the project: no name, no path. The text the agent writes follows the same rule: it names nothing of the project it was seen in (repo, owner, project id, tracker ids, people, customers) and says "a client project" instead; the skill has the agent check the draft for such names before the person says yes. Anyone with a GitHub login may report; only a login with push access may set labels, so without it the issue gets none and its first line is `Suggested labels: bug, agent` for a person to set. Prints `{ ok, task, url, created }` like `tenbox task new` |
| `tenbox install` | Symlinks every file of `agents/` and `workflows/` and every folder of `skills/` into `~/.claude/`, from the main checkout of the Tenbox repo, also when run from a task worktree; outside a git checkout it fails with `no-repo`. Never overwrites a foreign file |

The base is the manifest `base`, `main` by default; `--base` overrides it for `start` and
`check`. Task ids are letters, digits, `_` and `-`.

**New failures only.** A check fails only on failure lines that the base commit does not
already have. The failure lines of the base (the baseline) are kept per project, check and
commit under `~/wt/.baselines/`. `tenbox check` uses the baseline of the base commit, else
the newest one it has. With none at all, it runs the check once in the main checkout when
that sits at the base commit, and saves the result. An older baseline lacks the failures main
gained since: when a check has new failures against one (or against none), it takes the base
commit's own baseline first, in a temporary detached worktree at that commit (`setup`, then the
check, then the worktree is removed), saves it, and judges again. Each check result names its
baseline: `{ sha, source, failures }`, `source` one of `exact`, `newest`, `main`, `base` (taken in
the temporary worktree) or `none`.

**Flaky.** A check with a new failure runs once more. A new failure is then a line that both runs
have, or the crash line (`exit N: ...`) of the second run. A new failure line that only one of the
two runs has is flaky: it failed once and passed once, so it does not fail the check, and it is
listed in `flaky` in the result and in `summary`. A failure line is compared without its colours,
its outer spaces and a trailing duration (`[8.00ms]`, `(12 ms)`, `in 3s`, `144ms`), so one test that fails in
both runs is one new failure and not flaky. A check with no new failure runs once.
The check log holds both outputs. The CI workflow runs `bun test` itself, not `tenbox check`, so
it has no rerun.

**`stats.json`** (in the task dir): timeline, minutes per step (plan, wait for approval,
build, review, wait for merge), plan difficulty and estimated lines (from `plan.json`, null without it), the title (from `task.json`), rounds, review counts, code
lines, and each workflow agent with its model, seconds, tokens, `round` and usage (`calls`,
`input`, `output`, `cache_write`, `cache_read`, summed from its transcript; null without one), and
`runs` (`{ workflow, started, finished }` per workflow run, `finished: false` for a run with no run file; null without session files). It also holds the worker
`proofs` (part, test file, test name, failure text), `points` per part, and `findings`: each
finding's `title` and the `task: { id, url }` that `tenbox build done` opened for it, null when none was, from `build.json`, empty without it. Proofs come from
`proofs.json` (`tenbox proof` and `tenbox build done`); a part file's Markdown text gives none.
The review counts (`must_fix` 0 only for `ready-for-you`, `nice_to_have`, `attention`) and the
`unproven` items come from `build.json`; without it `review` is null. Claude Code session
files give only times, agents and tokens. A Claude Code file (run file, journal, agent meta, transcript) that does not fit gives one `warning: <file>: ...` line on stderr and is passed by; a transcript or journal line that does not fit is skipped and counted in that line. Lines of the types Tenbox does not read (such as `user` lines) are not counted. `proofs[].part` and `points[].part` hold the part number (`01`, not
`01-users`). The same part number, test file and test name counts once, the first one.
Points: +1 per distinct proof, -1 per `unproven` item in `build.json`, at most one per part per build round.
The reviewer's sentences are not kept.
`rounds` lists the build rounds: every `rounds/N` directory, except (with a `build.json`) one whose
`checks.json` was written after `build.json`, which is a `tenbox check` run by hand after the build;
without `build.json` every round counts. The close comment's round count is this list.
`minutes.review` is the end of the last build run to the PR's creation, at least 0 (`tenbox build done`
opens the PR before the run ends); `minutes.wait_merge` is
the PR's creation to its merge. Both come from the one `gh pr view` call of the close and are null
without a PR and with `--force`. The time from the merge to the close is not kept. Schema 7 (6 had no `findings`, 5 no `runs`).
`code` leaves out generated files: those marked `linguist-generated` in `.gitattributes`. To
mark a new one, add a line such as `bun.lock linguist-generated`; GitHub folds it in PR diffs too.

| Variable | Does |
|---|---|
| `TENBOX_HOME` | Where task dirs are kept; default `~/.tenbox` |
| `TENBOX_WT_ROOT` | The worktree root; default `~/wt` |
| `WTBASE_DIR` | Where baselines are kept; default `<worktree root>/.baselines` |
| `WTBASE_PATTERN` | The failure pattern when the manifest has none |
| `CLAUDE_CONFIG_DIR` | Where `tenbox install` links to; default `~/.claude` |
| `LINEAR_API_KEY` | The Linear key when the manifest has no `tracker.api_key` |
| `CLICKUP_API_KEY` | The ClickUp key when the manifest has no `tracker.api_key` |
| `TENBOX_DEBUG` | `1` logs spawned commands and prints stacks |

## Task kinds

A kind is a preset of the build's depth (`KIND_PRESETS` in `domain/kinds.ts`). The planner
picks it in `plan.md` and returns it as `kind`; `tenbox start --kind` sets it by hand and wins;
a plan without one is `normal`. `tenbox build` applies it to the args, `tenbox build done` to
the check tier and the diff limits.

| Kind | Review rounds | Extra lenses | Check tier | Diff limits |
|---|---|---|---|---|
| `docs` | 1 | none | `fast` | only `.md` files (any case) |
| `small` | 1 | none | `fast` | 5 files, 100 changed lines |
| `normal` | 3 | the plan's or group's own | the group's own (`full` without groups) | 20 files, 400 changed lines |
| `large` | 3 | `security` and `contract` | `full` | none |

Changed lines are added plus removed lines. The kind does not change a group recipe's `model`
and `effort`. A `ready-for-you` build whose diff is over its limits gets `kind-raised` from
`tenbox build done`, with the next kind whose limits it fits.

## The workflows: `workflows/`

Plain JavaScript Claude Code workflows, linked by `tenbox install`.

**`/tenbox-plan <id>`**, or `{ task, deep: true }` to run the planner on the strongest
model. One planner reads the task and the code and writes `.tenbox/plan.md`, one part file
per part and `questions.md`. It returns the kind, the summary, the estimated lines, the parts (`id` and
`difficulty`), the examples, the decisions, the extra review lenses and the questions. A runner then
saves the result with `tenbox plan done`; the workflow adds its JSON as `recorded`.

**`/tenbox-build <args>`**: `tenbox build <id>` sends the args as one line of JSON,
`{ task, kind, reviews, parts, lenses, groups }` from `plan.json`, the kind applied; the object
may also have `feedback`, `maxRounds` (default 3) and `answer`. `reviews` is how many rounds
each group (or the task without groups) may review; without it, `maxRounds`. The workflow parses args that are a string starting with
`{`. Args without a `parts` list, such as a task id alone, throw an error that names
`tenbox build <id>`; `tenbox build` checks the approval before it sends. Then each round:

1. **Build**: round 1 takes the parts and the extra lenses from the args; a round after a
   review with `must_fix` items runs one worker, part `fix`, with every item as its feedback and
   the lenses of that review, and no planner; any other later round asks
   the planner for the parts still to build and the done parts the feedback asks to change. One
   worker per part, one after another, in the task worktree. A part of `plan.json` has no goal
   in the prompt: the worker reads its part file. A part marked `hard` gets the strong model.
   A blocked worker ends the run with `needs-you`, its `part` and its decision card
   (`decision`, see `tenbox answer`). With `answer: { round, part, option, text }` in the args
   (`tenbox answer` resumes the run so), only the worker of that round and part gets the
   chosen option in its prompt; every earlier agent returns from the resume cache.
2. **Commit and checks**: the worker prompt names two commands. `tenbox part done <id>
   --part NN --commit <hash>` (with `--since` the checks commit of the scope's last green part,
   none before the first, and `--group N` in a group) verifies the worker's last commit; the
   worker runs it and returns its JSON as `partDone` (`{ ok, commit, error }`); a result with
   no `commit` did not run and counts as refused. Then `tenbox check <id>` (the `fast` tier);
   later workers of the round get `--round <N>`, with `N` from the first check's JSON. The
   worker runs it after its commit and returns its JSON as `checks`
   (`{ ok, commit, round, file, summary }`); a check with no `commit` or `file` did not run
   and counts as red. On a refused commit or a red check the same worker runs once more in
   the same round, with the error or the check summary in its prompt; the prompt tells it to
   set `status: todo` in its part file first. The `fix` part of a must_fix round has no part
   file: its retry prompt carries `Round feedback:` with the must_fix items instead. A second
   refusal or red check ends the round with no review, and the next round's feedback is `part NN: <error or summary>`. When every part passes, the last part check feeds the review. With no
   part listed, one runner runs `tenbox check <id>` before the review.
3. **Review**: the `base` lens always runs; `security` and `contract` run when the plan
   asks for them. Any `must_fix` item becomes the next round's feedback. A reviewer
   returns at most 3 `nice_to_have` items, each a concrete failure, and at most 2 `findings`:
   bugs or gaps outside the task, each a task draft `{ title, why, what, done }` that
   `tenbox build done` opens in the project's tracker. In a feedback round
   the reviewer reads only `git diff <commit>..HEAD`, where `<commit>` is the checks
   commit of the last reviewed round. A round with no `must_fix` item ends `ready-for-you`.
   When the group (or the task) has reviewed `reviews` rounds, the next round builds the
   `must_fix` items and runs the checks, and green checks end it `ready-for-you` with no
   review. So a `small` task with one `must_fix` item runs one review in the whole run.

Every end status runs `tenbox build done` through one runner (`record build`); for
`ready-for-you` it checks the latest `checks.json`, runs the `full` tier and opens the draft PR
(see `tenbox build done`). So a one-part plan with green checks and clean reviews runs one
worker, one reviewer per lens and one runner. When `tenbox build done` refuses a
`ready-for-you` result with `check-failed` from the `full` tier (`details.tier: "full"`), the
group in `details.group` runs one more round with the error message as feedback, and the end
goes to `tenbox build done` again; with no round left the build ends `failed` with that
message as `feedback`. When it refuses with `kind-raised`, the build takes the new `kind` and
`reviews` from `details`, and every group (or the task) runs one more round with no parts: a
runner runs `tenbox check`, then, while the group has review rounds left, the `base` lens and
the `details.lenses` review the whole diff again. `must_fix` items then run fix rounds as above;
with no round left the build ends `failed`. The next `tenbox build done` result has
that `kind` and the refusal message as one more `attention` line. Any other
refusal of `ready-for-you` is recorded by a second `tenbox build done` as `failed`, with the
refusal message as `feedback`. The workflow returns the result below with the same keys for
every status (`status`, `round`, `proofs`, `attention`, `nice_to_have`, `unproven`, `findings`) and the
last `tenbox build done` JSON as `recorded` (with `pr` for an accepted `ready-for-you`; the
result has no top-level `pr`). `failed` gives `round`, the last round. It returns
`ready-for-you` with the attention and nice-to-have lists of all reviewed
rounds (`attention` holds one item per hunk, merged across lenses and rounds by one `reviewer` agent, `merge attention`, that
keeps an earlier round's item only while its hunk is in the last round's diff; with no items, or fewer than two reviewed rounds over all groups, there is no merge agent and the raw items stay, and
a reply that does not come back leaves the raw items), `needs-you`, or `failed` with the last feedback after the last round. Every result,
`needs-you` too, also has `unproven`: the reviewers' items from all rounds, one per part
per round, and `findings`: the reviewers' task drafts from all reviewed rounds. It also has `proofs`: the worker proofs `{ part, file, test, failure }` from all
rounds; `tenbox close` counts them (see `stats.json`).

**Groups.** With `groups` in the args, each group runs its own rounds, and groups whose needs
do not wait for each other run in parallel. A group starts when every group in its `needs`
ends `ready-for-you`; a group whose need ends `needs-you` or `failed` starts nothing. Group 1
works in the task worktree; a group above 1 first has a runner run
`tenbox worktree <id> --group N` (`round 1: gN worktree`). Then its rounds run as above, with
these changes: labels are `round R: gN ...` (`round 1: g2 03`); round 1 builds the parts of
the args that are in the group's `parts`, and a later round asks the planner for the parts of
that group only; a group with no part in the args (all its parts were done when `tenbox build`
sent them) runs nothing and ends `ready-for-you` with round 0, and opens its worktree only when
a red full tier or a raised kind gives it a round; the worker and reviewer prompts of a group above 1 name the group worktree;
the check command is `tenbox check <id> --group N`; the workers get the recipe `model` and
`effort`; and the extra lenses are the recipe `lenses`. The run ends `needs-you` when a group
needs you, with the round, part and card of the lowest such group; else `failed` when a group
failed, with each failed group's feedback (`group N: ...`); else `ready-for-you`. Its `round`
is the highest round of the groups.

**`/tenbox-close <id>`**. Run it in a `claude` session in the main checkout, after you squash
merged the PR on GitHub. One runner runs `tenbox close <id>` and the workflow adds its JSON as
`closed`. It returns `{ status: "closed", closed }` when the close worked, `{ status: "refused",
closed }` when `tenbox close` refused before it changed anything (`unmerged`, `merge-commit`,
`in-task-worktree`, `dirty`), and `{ status: "failed", closed }` for any other error.

## Roles: `agents/`

| Role | Model | Does |
|---|---|---|
| planner | opus | Writes the plan, the parts and the questions; writes only under `.tenbox/` |
| worker | sonnet | Builds one part with its tests, proves each change of behaviour with a test that fails first, runs the checks, commits, fills the part file |
| reviewer | sonnet | Reviews the diff through one lens; returns `must_fix`, `nice_to_have`, `attention`, `unproven`, `findings`; never edits |
| runner | sonnet | Runs one `tenbox` command and returns its JSON unchanged |

## The skill: `skills/tenbox/`

`tenbox install` links the folder to `~/.claude/skills/tenbox`, so a Claude Code session in
any project lists the `tenbox` skill and knows when to use it. The skill holds no command
details. When it loads, it runs `tenbox help` for the commands of the installed tenbox; its
`allowed-tools` let `tenbox help *` run without a permission rule. It tells the agent to run
`tenbox help <command>` for the flags, input and output of one command, and links this
reference on GitHub for the flow and the manifest; it does not read this file from disk. The
rest is the order of the steps and what an agent leaves to the user: the approval, the answers
and the merge. It also says what to do with a
bug or a gap outside the task at hand: `tenbox task new` in the project's tracker, and the task
stays small; and with a bug of Tenbox itself: show the user the draft and run `tenbox report`
only after they say yes, never from a workflow; the draft names nothing of the project (a client project, not its repo, owner, project id, tracker ids, people or customers), and the agent checks it before the person says yes.

Every project runs the tenbox of the main checkout of the Tenbox repo: `tenbox` (`bun link`),
the links and the skill all come from it. So the main checkout stays on one branch, `main`,
and work happens only in task worktrees: half-done code there never reaches another project.
A merge plus `git pull` in the main checkout is the release; the commit is the version.

## The babysitter skill: `skills/tenbox-babysitter/`

`tenbox install` links it to `~/.claude/skills/tenbox-babysitter` like every folder of
`skills/`. A person runs it as `/tenbox-babysitter <name>`: the session takes the tasks of lane
`<name>` through tenbox, from start to close. Claude never loads it alone
(`disable-model-invocation: true`). `SKILL.md` holds the steps and who decides what;
`references/` holds the task flow, the box notes, the lane file template and the handover.
It lists no commands: it uses the `tenbox` skill and `tenbox help`.

It first reads the project file: the path under `babysitter:` of `tenbox.yaml`, default
`tenbox-babysitter.md`. The project file holds the rules of one project and names the lane
directory, outside git, with `<name>.md` (the lane file), `inbox-<name>.md` and `lessons.md`.
When the project file, its lane directory or the lane file is missing, the skill answers one
line that names what is missing and stops. No tenbox code reads `babysitter:`; the manifest
schema only checks that it is non-empty text (else `manifest`).

## Task files: `.tenbox/`

The files live in the task dir `~/.tenbox/<project id>/<id>/`. The task worktree has `.tenbox`, a
symlink to it, excluded from git (pattern `.tenbox`, no slash, so it matches a link):

```
.tenbox/
├ task.md          tenbox start: id, title, tracker, url, description, then `## Comments` (tracker comments, oldest first)
├ task.json        tenbox start: id, title, status, tracker, url (null without one), kind with --kind
│                  `status`: started (tenbox start), plan-ready (plan done), approved (approve), building (build,
│                  decide, approved, answer), the build.json status (build done), closed (close; the task dir stays). A failing command keeps it
├ plan.md          planner: the why of the plan in free text, at most 60 lines
│                  (tenbox start --kind docs: the title and the task description)
├ plan.json        tenbox plan done: the validated planner result, read by build, approve, close and
│                  plan show. `kind` is `docs`, `small`, `normal` (the default) or `large`. `examples`: `{ part, title, before, after }`, one per behaviour of a
│                  part. `decisions`: `{ title, options, taken, reason }`, one per real choice,
│                  `taken` counted from 1; tenbox decide can change it. Its optional
│                  `groups` key lists the groups: `{ id, name, parts, needs, recipe }`. The ids
│                  are 1..n in order; every part is in exactly one group; `needs` holds smaller
│                  ids only; `recipe` is `{ model, effort, lenses, tier }`. A bad value is `bad-input`
├ build.json       tenbox build done: the last build result with its kind and the task of each finding, read by close; tenbox answer adds answered
├ approved.json    tenbox approve: { at, plan_sha } of the approved plan.json
├ questions.md     planner: open questions by kind (product, technical, contract, risk)
├ decisions.md     tenbox decide and tenbox answer: answers and notes; every agent reads it first
├ answer.log       the output of a tenbox answer run from a task session
├ auto-answer.log  the output of the background tenbox answer --auto
├ parts/01-x.md    one per part: status, files, acceptance, history, result (01-docs.md for --kind docs)
├ proofs.json      tenbox proof: the proofs recorded by hand, a JSON array
├ groups/N/        groups above 1: group.json { start } (tenbox worktree) and rounds/R/ (tenbox check --group N)
└ rounds/N/
  ├ checks.json    tenbox check (fast tier); read by status, pr, build done and close; one that is not
  │                JSON or misses a field (one from before `tier` or `flaky`) is `bad-file` (exit 1)
  ├ checks-full.json  tenbox check --tier full
  └ checks/*.log   the output of each check
```

`tenbox close` keeps the task dir, adds `stats.json` to it and removes the worktree, so `.tenbox` goes with the worktree.

## The manifest: `tenbox.yaml`

```yaml
id: k7f3qa                       # 6 characters, a-z and 0-9; tenbox start adds it when missing; only in tenbox.yaml
project: tenbox                  # optional; default: the main checkout's directory name, or its parent's when it is `main`
base: main                       # optional: the branch tasks start from and merge into
setup: bun install               # optional: runs in a new task worktree
checks:                          # name: command; tenbox check runs them all (the fast tier)
  types: bunx tsc --noEmit
  unit: bun test cli domain
# checks:                        # or two tiers: fast every round, full once at the close of a round
#   fast: { types: bunx tsc --noEmit, unit: bun test cli domain }
#   full: { e2e: bun test e2e }  # a name in both tiers is an error
model: sonnet                    # optional: the --model of the task's claude session; default sonnet
failure_pattern: "..."           # optional: a regex for a failure line; the default knows bun, vitest, jest and tsc
tracker: { kind: linear, team: TEN }   # none (default), linear, clickup or github; api_key here or LINEAR_API_KEY / CLICKUP_API_KEY; team: where tenbox task new writes
# tracker: { kind: clickup, list: "901234567", statuses: { in_progress: "doing", done: "complete" } }   # list: where tenbox task new writes; optional status names: queued, in_progress, review, done
notify: { ntfy: "https://ntfy.example.com/my-private-topic" }   # optional; without it nothing is sent
names: { branch: "feat/{id}", session: "tenbox-{id}" }   # optional; these are the defaults; session is the claude -n name; an unknown key such as the old tmux is an error
machine: { template: ~/tenyard/task }   # optional; the default; the directory of tenyard's job.yaml and pvc.yaml; another key is an error
# machine: { env: { TEST_MAX_WORKERS: "1" } }   # optional; variables of the command in the box: shell names, text values
# machine: { plan_class: heavy }   # optional; the resource class of tenbox start in the box (the planner): plan, build or heavy; default plan
# machine: { class: heavy }   # optional; the resource class of a build in the box: plan, build or heavy, with the numbers of tenyard's classes.yaml; default build; another name is an error
# machine: { services: [postgres] }   # optional; sidecars of a build in the box, files of tenyard's services/; a start or close gets none; tenbox check on your computer starts none
decisions:                       # optional; decisions that hold for every task, non-empty text lines; default none
  - "Boxes run no real eval: no plan step or worker runs it; the person runs it on their computer."
babysitter: tenbox-babysitter.md # optional; the project file of the tenbox-babysitter skill, a path from the project root; non-empty text; default tenbox-babysitter.md
```

**Project decisions.** The planner, the worker and the reviewer read each line under
`decisions:` of the task worktree's `tenbox.yaml` (not of a local layer) like a line of `.tenbox/decisions.md`: final,
never asked again, and a step it rules out is not planned or run (`agents/*.md`). So a fact of
the project is written once, not as a `tenbox decide` note for every task. Tenbox itself only
checks that each line is non-empty text (else `manifest`).

**Notifications.** With `notify.ntfy` (a topic URL, `<server>/<topic>`) Tenbox publishes one text
line as ntfy JSON (`POST <server>` with `{ topic, message }`) when a person must act, and only then:
`<project> · <task id> · <state> · <detail> → <next command>`. The body also has `click`, the
session link `https://claude.ai/code/<bridgeSessionId>`, so a tap opens the task's session. It
comes from the `<claude dir>/sessions/*.json` file with the newest `startedAt` whose `cwd` is the
real path of the task worktree and that has a `bridgeSessionId`, read at each send (a resumed
session gives its new link); without such a file there is no `click` key. The file format is not
a public API; only `cli/infra/claude/sessionLinks.ts` reads it. The states:

| State | When | Detail | Next command |
|---|---|---|---|
| `needs-you` | `tenbox build done` with status `needs-you` | the decision card title | `tenbox answer <id> <recommended option>`; `tenbox attach <id>` without a card |
| `ready-for-you` | `tenbox build done` with status `ready-for-you` | the round and the attention, nice-to-have and unproven counts; the draft PR is open | `tenbox pr <id> --ready` |
| `failed` | `tenbox build done` with status `failed` | none | `tenbox attach <id>` |
| `check-failed` | `tenbox check` with a new failure | the checks, the count and the round; `the build goes on` while there is no `build.json` | `tenbox attach <id>` |
| `pr-opened` | `tenbox pr` creates the PR (an update sends nothing) | the PR URL | `tenbox close <id>` |
| `plan-ready` | `tenbox plan done` saves a valid plan | `parts <n>, open questions <m> (<b> blocking)` | `tenbox approve <id>` |
| `blocked` | the task's background session waits on a permission prompt (`tenbox hook blocked`) | the message of the prompt, else `permission prompt` | `tenbox attach <id>` |
| `idle-volume` | the server's volume watch finds an open task's volume with no run for 7 days; the server sends it to `TENBOX_SERVER_NTFY`, not to `notify.ntfy`, with no `click` (see `server/` below) | `<days> days` | `tenbox machine rm <id>` |

A failed send is one stderr line (`notification not sent: ...`); the command's JSON and exit
code stay the same. The line holds the task id and the decision card title: use a private
topic. Desktop notifications do not exist; the manifest has no `desktop` key.

Layers, later ones win: `tenbox.yaml` (task worktree, else main checkout), then
`tenbox.local.yaml` in the main checkout, then in the task worktree, then
`.tenbox/override.yaml`. Keys of later phases are dropped without an error.

## Tracker

`none`: the task comes from `tenbox start --title`, and status changes are skipped.
`linear`: `tenbox start` reads the issue over Linear's GraphQL API and sets it to in
progress; `tenbox close` sets it to done.
`clickup`: the same over ClickUp's REST API v2, with the native task id (custom task ids such
as `WAG-12` are not supported). The statuses differ per list. In progress is the status named "in progress" and done is the
one named "done" (ignoring case). A project can name them with `tracker.statuses`
(`in_progress`, `done`). A name the list lacks is an error that lists the list's statuses and
shows the setting. `tenbox start` and `tenbox close` print the real status name in `status`
(or `skipped`, or `failed: <reason>`). Two statuses are optional: queued (`tenbox queue`), the
status named "queued", and review (a `ready-for-you` `tenbox build done`), the status named "in
review"; `tracker.statuses` names them with `queued` and `review`. A list that lacks the default
name skips the change (`skipped`, no request that writes); a name the project set and the list
lacks is the error above. `tenbox build` sets in progress again.
Linear and GitHub skip queued and review (`skipped`).
`github`: the issues of the repository of the current directory, through `gh` and its login;
no key. The task id is the issue number (`tenbox start 23`, branch `feat/23` unless
`names.branch` says otherwise). In progress leaves the issue open and `status` shows `OPEN`;
done closes it and shows `CLOSED` (an issue the merged PR closed already is not an error). A
`gh` failure, such as an unknown number or no login, fails the command with `gh` and gh's
message.

`tenbox task new` writes through `create` of the port, after `findOpen` looked for an open task
with the same title (`tenbox report` uses the `github` adapter on `enojen/tenbox` or
`enojen/tenyard`, whatever the project's tracker is; `tenbox build done` opens the findings of a
build the same way, in the tracker of the task worktree's manifest). `github`: `gh issue create` in the
repository of the current directory, or in the `--repo` of a report, the id is the issue number;
the search is `gh issue list --state open --search "in:title <title>"`, the exact match is
Tenbox's; before the labels it asks `gh api repos/<repo>` for `permissions.push`, and a login
without it sets no label and gets them as the first line of the body. `linear`: `issueCreate`
in the team `tracker.team` names by its key; without the setting the command refuses with
`tracker` and names it; the search is the team's issues with the exact title whose state is not
completed or canceled; with `--parent`, Linear first reads the parent issue and sends its id as
`parentId`. `clickup`: `POST /list/<tracker.list>/task` with the body as
`markdown_description` and the labels as tags; without `tracker.list` the command refuses with
`tracker` and names it; the search reads the open tasks of the list (one page). With `--parent`,
ClickUp first reads the parent task, writes to its list with `parent` in the body, and the search
reads that list with `subtasks=true`. `none` refuses with `no-tracker`.

The `Tracker` port has `comments`: `tenbox start` appends the comments of a tracker task to `task.md`
under `## Comments`, oldest first, each as `### <author> · <date>` and its body (top-level
comments, one page: Linear 250, ClickUp 25 newest, GitHub all; `none` and `--title` have none, and a task
without comments gets no section). A failed read fails the start.

## Repository layout

```
domain/       pure code: ids, failure lines, manifest schema, stats, events, the Tracker port,
              taskDirs.ts (every path under ~/.tenbox)
cli/          the tenbox CLI; entry cli/main.ts (layers: see CLAUDE.md)
  commands/     one file per CLI command
  application/  use cases
  infra/        git, gh, shell, files, env, baselines on disk, kubernetes (the cluster API), claude/ (Claude Code), tracker/ adapters
  test/         temporary projects and the CLI runner for tests
server/       the HTTP server (Hono); entry server/main.ts (`bun run server/main.ts`); binds `TENBOX_SERVER_HOST`, default `localhost` (loopback only).
              SIGINT or SIGTERM lets open requests finish, closes the database and exits 0
  routes/       `GET /health` returns 200 `{"ok":true}`; `GET /openapi.json` is the OpenAPI 3.1
                document built from the zod route schemas; `GET /docs` is Swagger UI; `GET /metrics` is open too
                (below). Every other path needs `Authorization: Bearer <token>` of a known user. Every error
                is an RFC 9457 problem, `application/problem+json`:
                `{ type: "about:blank", title, status, detail, code }`. No token: 401
                `unauthorized`; an admin-only route with a member's token: 403 `forbidden`; with a
                token, an unknown path is 404 `not-found`; a request body
                that fails its schema is 400 `bad-input` with the issue lines (`1.at: ...`) in
                `detail`; any other error is 500 and its message goes to stderr, not to the client.
                `GET /metrics` is open like `/health` and is not in `/openapi.json`: the Prometheus text
                format (`text/plain; version=0.0.4`) with one gauge series per worker that is up (a
                `node.added` without a `node.removed`),
                `tenbox_node_price_eur_hourly{node, server_type, location}`, valued at its
                `price_hourly.net`; no series when no worker is up.
                `POST /events` takes a list of events (`EventSchema` in `domain/events.ts`) and
                answers 200 `{ ok: true, stored, skipped }`. The list is all or nothing: one bad
                event is a 400 and none is stored. The whole list goes in one transaction; an
                event whose `id` the server has, or that comes twice in the list, is skipped.
                `user_id` is the user of the token, not the `user` of the body. A node event (`node.added`,
                `node.removed`), a volume event (`volume.added`, `volume.removed`) or a `job.finished` is not
                in `EventSchema`: only the server makes it, so a post of one is a 400.
                `GET /costs?from=<iso>&to=<iso>` reports what the workers and the task volumes of the cluster
                were paid for in that window and what each task used of it (`costReport` in `domain/costs.ts`). It is only for a
                user who is an `admin` of at least one organization (the costs are cluster-wide, of every
                project); a `member` only gets 403 `forbidden`. `from` and
                `to` are ISO date-times with `Z` or an offset, `from` before `to`, else a 400 `bad-input`.
                It answers 200 `{ ok: true, from, to, workers, volumes, tasks, total }`. A worker line is one Hetzner
                server, the oldest first:
                `{ node, server_id, server_type, location, paid_hours, busy_hours, waste_hours, eur }`.
                Hetzner bills each started hour whole, from the server's `created`: `paid_hours` counts the
                hours `at + k h`
                of its `node.added` that start at or after `from` and before its `node.removed` `at`, or
                before `to` when it is still there (no cap at the monthly price). `eur` is `paid_hours` times
                `price_hourly.net`, computed exactly and rounded half up to cents, as decimal text
                (`"0.02"`). A server with no paid hour in the window has no line; the control plane
                (tenbox-ci) is a worker line like any other. A volume line is one task volume, the oldest
                `volume.added` first: `{ volume, task, project, size_gb, gb_hours, eur }`. Volumes are
                matched by PVC uid; its time runs from its `volume.added` `at` to its `volume.removed` `at`,
                or to `to` when it is still there, cut to the window, and a volume with no time in the window
                has no line. `gb_hours` is `size_gb` times those exact hours; `eur` is `gb_hours` times
                `price_per_gb_month.net / 730`, computed exactly and rounded half up to cents. The PVC has no
                project label, so `project` is the `project` of the `job.finished` of the task id with the
                newest `finished`, null without one. `total` is `{ paid_hours, gb_hours, eur }`: the paid hours of the
                worker lines, the GB-hours of the volume lines and the `eur` of both.
                `busy_hours` is the union of the box pods that ran on the server, from the `started` to the
                `finished` of their `job.finished`, cut to the window and to the server's time: a pod is on
                the server whose Node name it has and that was there then; pods that overlap count their
                overlap once; a pod with `started` null never ran and adds nothing; a pod counts once its
                `job.finished` is stored. `waste_hours` is `paid_hours` minus `busy_hours`; it can be below 0
                for a server that came before `from`, whose busy time in the first part-hour of the window
                was paid in the window before. A task line `{ project, task, workers: [{ node, server_id, eur }], volumes: [{ volume, eur }], eur }`,
                one per project and task id (the same id in two projects is two lines; `project` is the
                `project` of `job.finished`, null when it has none), by project, then task id, a null
                project first, splits the busy EUR of each worker it ran on (`busy_hours` times
                `price_hourly.net`) over its tasks by memory request (`requests.memory`, a Kubernetes quantity
                such as `2Gi`) times the time of their pods on it, rounded half up to cents per worker; its
                `volumes` are its volume lines and `eur` is the sum of its workers and its volumes; a task
                with only a volume in the window has a line with `workers: []`. A pod with no memory request weighs 0. Waste stays on the
                worker line and is not split over tasks.
                `GET /tasks/{task}/runs` answers 200 `{ ok: true, runs }`: the bodies of the `job.finished`
                events whose subject is the task id, oldest `finished` first; `runs: []` for a task with none
                `POST /run-credentials` `{ placeholder, host }` is for the injector only (tenyard
                `injector/`): it takes no user token, also not an admin's, but `Authorization: Bearer` with
                the token of `TENBOX_SERVER_INJECTOR_TOKEN_FILE` (compared in constant time; any other is 401
                `unauthorized`), and that token opens no other route. It answers 200 `{ ok: true, value }`
                with the run token of the open Job whose placeholder it is, for `github.com` and
                `api.github.com` only; another host, a placeholder of no open Job or a repository without
                the App is 404 `run-credential-not-found`. The route exists only with the run token watch;
                without it the path is an unknown route
  application/  organizations, users and projects: the rules (a GitHub name once; a project id once; the user, the
                membership and the token in one transaction).
                memberships: finds an organization where a user is an `admin`.
                costs: reads every node and volume event and every `job.finished` and builds the `GET /costs` report.
                nodes: the node watch. Inside the cluster (`KUBERNETES_SERVICE_HOST` set) the server lists the
                Nodes (`GET /api/v1/nodes`, with the pod's service account token and CA under
                `/var/run/secrets/kubernetes.io/serviceaccount`, the token read at each poll) at start and every
                30 seconds. A Node whose `spec.providerID` is `hcloud://<id>` and whose server has no
                `node.added` yet gets one `GET <HCLOUD_ENDPOINT>/servers/<id>` and one `node.added` event:
                `at` the server's Hetzner `created` time (UTC, `toISOString`), body `{ event, node, server_id,
                server_type, location, price_hourly: { net, gross } }`, the hourly price of the server type in
                its location as Hetzner gives it (decimal text). A server with a `node.added`, no `node.removed`
                and no Node in the list gets `node.removed`: `at` the poll time, body `{ event, node, server_id,
                server_type, location, late }` with type and location from its `node.added`. Until the first
                poll that succeeds, `late` is true and `at` is the start time: the node left while the server
                was down. Servers are matched by id. The row: `id` `<event>:<server id>`, so a poll after a
                restart stores nothing twice; `subject` the Node name; `user_id` null; `tenbox` `server`. A
                failed poll, or a server Hetzner cannot give, goes to stderr and the next poll tries again.
                Without `KUBERNETES_SERVICE_HOST` the server does not poll.
                machineRuns: the Job watch, in the same 30-second tick as the node poll; a failure of one
                does not stop the other. Each tick lists the pods of namespace `tenbox` with the label
                `app=tenyard` (`GET /api/v1/namespaces/tenbox/pods?labelSelector=app%3Dtenyard`). A pod whose
                `box` container is terminated and that has no event yet gets one log request
                (`.../pods/<pod>/log?container=box&tailLines=1`) and one `job.finished` event, body `{ event,
                task, project, job, pod, command, class, node, exit_code, oom, created, scheduled, started,
                finished, duration_ms, requests: { cpu, memory } }`: `task` and `class` the pod labels,
                `job` its `job-name` label, `project` and `command` the box env `TENBOX_PROJECT` and
                `TENBOX_CMD`, `node` `spec.nodeName`, `created` the pod's `creationTimestamp`, `scheduled` the
                `PodScheduled` condition's time, `started` and `finished` the box container's, `duration_ms`
                from `started` to `finished` (null when it never started), `requests` the box container's,
                `oom` true when the terminated reason is `OOMKilled` or the last log line has `oom_kill` above
                0; times in UTC (`toISOString`). A pod the last poll listed that is gone before its box ended
                (e.g. `tenbox machine stop`) gets the event with `exit_code` null, `oom` false and the poll
                time as `finished`; this memory is only in the process, so a pod that goes while the server
                is down is not recorded. The row: `id` `job.finished:<pod uid>`, so a second poll stores
                nothing and asks for no second log; `subject` the task id (the pods carry no project id);
                `user_id` null; `tenbox` `server`; `at` the `finished` time. A failed pod list, or a failed
                log of one pod, is one stderr line (`job watch: ...`) and the next poll tries again. A pod whose
                `TENBOX_CMD` has `close` as its second word and whose box ended with exit code 0 gets the whole box log
                (`.../log?container=box`, no `tailLines`) instead of the last line, and one more event
                `close.output:<pod uid>` (subject the task id, `user_id` null, `tenbox` `server`, `at` the
                `finished` time): its body is the last top-level JSON object of the log (from a `{` line to the
                next `}` line at column 0, as `tenbox close` prints it), checked to be `{ ok: true, task }` and
                kept whole, so the stats of the task are on the server. A log with no such object is one stderr
                line and no `close.output` (the `job.finished` is stored); a `close` pod with another exit code and a pod of
                another command ask for the last line only and store no `close.output`; a server that was
                down while the Job stayed (10 minutes) misses it. The
                server's service account needs `list` on `pods` and `get` on `pods/log` in namespace `tenbox`
                (tenyard Role `tenbox-server-runs`); without it each poll logs the 403
                volumes: the volume watch, in the same 30-second tick; a failure of one poll does not stop the
                others. Each tick lists the PVCs of namespace `tenbox` with the label `app=tenyard`
                (`GET /api/v1/namespaces/tenbox/persistentvolumeclaims?labelSelector=app%3Dtenyard`). A PVC with
                a `task` label, phase `Bound` and a `status.capacity.storage`, and no `volume.added` yet, is a
                new volume; the new volumes of a tick get one `GET <HCLOUD_ENDPOINT>/pricing` and one
                `volume.added` each: `at` the PVC's `creationTimestamp` (UTC), body `{ event, volume, uid, task,
                size_gb, price_per_gb_month: { net, gross } }`: `volume` the PVC name, `uid` its uid, `task` its
                `task` label, `size_gb` the capacity in GiB rounded up (Hetzner's "GB" of a volume is a GiB),
                the price `pricing.volume.price_per_gb_month` as Hetzner gives it (decimal text). A PVC with a
                `volume.added`, no `volume.removed` and no Bound PVC of its uid in the list gets `volume.removed`:
                `at` the poll time, body `{ event, volume, uid, task, size_gb, late }` from its `volume.added`.
                Until the first PVC poll that succeeds, `late` is true and `at` is the start time: the volume
                went while the server was down. Volumes are matched by PVC uid. The row: `id`
                `<event>:<uid>`, so a poll after a restart stores nothing twice; `subject` the PVC name;
                `user_id` null; `tenbox` `server`. A failed PVC list or price is one stderr line
                (`volume watch: ...`) and the next poll tries again. The server's service account needs `get`
                and `list` on `persistentvolumeclaims` in namespace `tenbox` (the tenyard Role of the server,
                `install/server/server.yaml`); without it each poll logs the 403 and no volume is recorded.
                With `KUBERNETES_SERVICE_HOST` the same poll then goes by two rules, read from the stored
                events and the PVC list. A listed volume is closed when its task (the `task` label) has a
                `close.output` newer than the PVC's `creationTimestamp` and no `job.finished` whose `created`
                is after the newest `close.output`; else it is open. A closed volume whose newest `close.output`
                is `TENBOX_SERVER_VOLUME_GRACE_DAYS` (default 3) days old or more gets one
                `DELETE /api/v1/namespaces/tenbox/persistentvolumeclaims/<name>`; an answer 404 counts as gone,
                and `volume.removed` then comes from the PVC list as above. An open volume whose idle stretch
                started 7 or more whole days ago gets one `idle-volume` notification (`POST <server>` with
                `{ topic, message }` to `TENBOX_SERVER_NTFY`): `<project> · <task> · idle-volume · <days> days →
                tenbox machine rm <task>`, `<project>` the `project` of the task's newest `job.finished` that has
                one, else the PVC name. The stretch starts at the newest `finished` of the task's `job.finished`
                events, or at the PVC's `creationTimestamp` when that is newer. After the POST the server
                stores `volume.idle` (`id` `volume.idle:<uid>:<stretch start>`, `subject` the PVC name, `at` the
                poll time, body `{ event, volume, uid, task, since, days }`), so later polls send nothing until a
                new run ends and 7 more days pass; nothing is deleted. Neither rule acts while a pod of the task
                is listed: the pods of namespace `tenbox` with the label `app=tenyard` are listed once per poll,
                only when a rule is due. Without `TENBOX_SERVER_NTFY` no notice is sent or stored, and a poll
                with idle volumes gives one stderr line. A failed pod list, DELETE or POST is one stderr line
                (`volume watch: ...`) and the next poll tries again. The DELETE needs `delete` on
                `persistentvolumeclaims` in namespace `tenbox` in the tenyard Role of the server
                (`install/server/server.yaml`, a change made by hand in tenyard); without it each due volume
                logs the 403 at each poll and nothing is deleted. Deleting cannot be undone: a server that missed
                the close (down while its Job stayed) has no `close.output` and deletes nothing
                runTokens: the run token watch, with `TENBOX_SERVER_GITHUB_APP_ID` set: now and every 5
                seconds it lists the Jobs of namespace `tenbox` with the label `app=tenyard`
                (`GET /apis/batch/v1/namespaces/tenbox/jobs?labelSelector=app%3Dtenyard`). Each Job with a
                `project-id` label and no condition `Complete` or `Failed` True gets one Secret
                `<job name>-github` (`POST /api/v1/namespaces/tenbox/secrets`, owned by the Job, so the
                cluster deletes it with the Job; an answer 409 counts as written) with one key, `token`: the
                run's placeholder, `tbxph_` and the base64url HMAC-SHA256 of the Job's uid with the key of
                `TENBOX_SERVER_RUN_CREDENTIAL_KEY_FILE`, the same after a restart. It first asks a token of the
                GitHub App for the `repo` of the project of that id (`github.com/<owner>/<name>`, an https
                URL or `<owner>/<name>`) with the App's JWT (`GET /repos/<owner>/<name>/installation`, then
                `POST /app/installations/<id>/access_tokens` with that one repository and `contents`,
                `pull_requests` and `issues` write), which GitHub ends after one hour, and keeps it in memory
                for `POST /run-credentials`; an empty `token` when the server has no project of that id or
                the App is not installed on its repository (404), and the box then stops at start. That
                route lists the open Jobs again, finds the one whose placeholder it is, and answers the kept
                token while more than 10 minutes of it are left, else asks a new one; the token of a Job
                that is no longer open is dropped. One stdout line per Secret names the Job and the end of
                the token, never the token or the placeholder. The Jobs it wrote are kept in memory
                for the next polls; after a restart a Job still open gets a 409. A failed list, token or
                Secret is one stderr line (`run token watch: ...` or `run token of <job>: ...`) and the next
                poll tries again: until then the pod waits for its Secret. The server's service account needs
                `list` on `jobs` (`batch`) and `create` on `secrets` in namespace `tenbox` (tenyard Role of the
                server); it reads no Secret
  commands/     `tenbox-server user add --name <n> --github <g> --org <o> [--email <e>]
                [--type admin|member]` (default `member`) finds or makes the organization,
                makes the user and prints `{ ok, user, organization, type, token }` on stdout.
                The `tbx_` token is shown once; only its SHA-256 hash is stored. The same
                `--github` again exits 1 with `code: "user-exists"`. A lost token cannot be
                shown again: delete the user row (its memberships go with it) and add the
                user again.
                `tenbox-server project add --id <id> --name <n> --repo <r> --org <o>` (all four
                required; the id is 6 characters, a-z and 0-9) finds or makes the organization,
                adds the project and prints `{ ok, project, organization }`. The same `--id`
                again exits 1 with `code: "project-exists"`
                `tenbox-server backup --to <file>` writes a consistent copy of the database
                (`VACUUM INTO`); it opens the database read-only and applies no migration;
                exits 1 with `backup-exists` when the file exists and `no-database` when
                there is no database
                `tenbox-server costs --from <iso> --to <iso>` prints `{ ok: true, from, to, workers, volumes,
                tasks, total }`, the body of `GET /costs`, for the window, read from the database without a
                token; `kubectl -n tenbox-server exec deploy/tenbox-server -- tenbox-server costs ...`
                runs it in the cluster. A missing flag exits 1 with `usage`, a bad or reversed window
                with `bad-input`, no database with `no-database`; like `backup` it opens the database
                read-only and applies no migration, so it creates and changes no database
  infra/        env (`TENBOX_SERVER_HOST`, default `localhost`; `TENBOX_SERVER_PORT`, default 4300; `TENBOX_SERVER_DB`, default
                `~/.tenbox-server/server.db`; Bun reads `.env`; inside the cluster `KUBERNETES_SERVICE_HOST`,
                `KUBERNETES_SERVICE_PORT`, default 443, and `HCLOUD_TOKEN`, a read-only Hetzner Cloud token,
                with `HCLOUD_ENDPOINT`, default `https://api.hetzner.cloud/v1`; without `HCLOUD_TOKEN` there
                `tenbox-server` prints `{ ok: false, code: "env" }` and exits 1 before it serves;
                `TENBOX_SERVER_VOLUME_GRACE_DAYS`, default 3, a whole number of days, and `TENBOX_SERVER_NTFY`,
                an ntfy topic URL from a Secret, unset or blank for no notice: another value stops the server
                with `env`, and the error does not show the URL; `TENBOX_SERVER_GITHUB_APP_ID`, the number of
                the GitHub App, and `TENBOX_SERVER_GITHUB_APP_KEY_FILE`, the file of its private key, read
                once at start, with `GITHUB_API_URL`, default `https://api.github.com`: both unset is no run
                token watch, one without the other, an id that is not a number or a file it cannot read stops
                the server with `env`; with the App, `TENBOX_SERVER_RUN_CREDENTIAL_KEY_FILE`, the key of the
                run placeholders, and `TENBOX_SERVER_INJECTOR_TOKEN_FILE`, the injector's token, each a file
                read and trimmed once at start: unset, unreadable or empty stops the server with `env`), the token
                maker, http (a JSON GET or POST with a bearer token), kubernetes (the Node list, the Job pods and the last log line of
                one, the task PVCs and the DELETE of one, the open task Jobs and the POST of a Secret), ntfy (one JSON
                publish), hetzner (one server, the volume price) and github (the App's JWT and one installation token
                for one repository)
    db/           the SQLite database with drizzle: `schema.ts` (`organizations`, `users`,
                  `memberships`, `projects`, `events`: `id` PK, `type`, `subject` (the event's task,
                  else round, else part; a node event's Node name; a volume event's or a `volume.idle`'s PVC name; a `job.finished`'s task id), `user_id` FK, null for an event the server makes, `tenbox`, `at`, `body` the event JSON) and `migrations/`. Opening the database applies the new
                  migrations. After a change to `schema.ts`, run
                  `bunx drizzle-kit generate --name <what>` and commit the new migration
    repositories/ data access per table, no rules: `find...`, `insert`
agents/       planner.md, worker.md, reviewer.md, runner.md
workflows/    tenbox-plan.js, tenbox-build.js, tenbox-close.js
skills/       tenbox/SKILL.md, the skill for a session in any project; tenbox-babysitter/,
              the skill of one lane (SKILL.md, references/)
machines/     the box image (k8s/), the login sync (login/) and the server image (server/); see machines/README.md
docs/         design.md (the target design), reference.md, the icon
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the tests and knip on each pull request, on our own
Linux runner (label `tenbox-ci`).

## Machines: `machines/`

Tasks run in a box on the cluster instead of your computer: one Job per tenbox command, one
volume per task. `machines/k8s/` is the box image: the `box` workflow pushes it to the private
`ghcr.io/enojen/tenbox-box` (`:latest` and `:<sha>`) on every merge to main. `tenbox machine
run TEN-301 -- tenbox build TEN-301` posts the task's volume `task-<id>` and one Job
`task-<id>-<MMDD-HHMMSS>` to namespace `tenbox` through the Kubernetes API with `fetch`, no
`kubectl`. Both come from tenyard's `task/pvc.yaml` and `task/job.yaml`, read at run time from
`machine.template`, with the services of `machine.services` from `task/services/` added to a
build, check, decide or answer; tenbox keeps no copy. `approve`, `decide`, `answer`, `check`, `pr`,
`status` and `plan show` run there too, so a task planned and built on the cluster is steered from
your computer. The login sync, `machines/login/`, writes the Secret
`claude-credentials` of the box in namespace `tenbox` (`credentials.json`, from
`~/.claude/.credentials.json`). GitHub goes only through the GitHub App: the box holds the run's
placeholder, which the server writes to `<job name>-github` (see `server/`; empty when the App is
not installed on the repository, and the box then stops at start), and the injector behind the
egress proxy (tenyard `injector/`) swaps it for the run token, one repository and one hour, on its
way to GitHub; the box trusts the injector's CA through `TENBOX_INJECTOR_CA`. The tracker key and
the ntfy URL are per project: `tenbox machine run` writes them to `project-<project id>` before
each Job. The Job reads the login through these Secrets, so
`tenbox machine run` first checks that your claude.ai login has not expired. A Job runs one
command and its session and is gone 10 minutes after it ends; `tenbox machine ls` lists the
Jobs and `tenbox machine logs <id> [--follow]` shows the log of the newest Job of a task;
`tenbox machine stop` ends a stuck run and keeps the volume. After the close Job has
ended, `tenbox machine rm <id>` deletes the task's volume (refused while a Job of the task is
active); the server's volume watch deletes it by itself `TENBOX_SERVER_VOLUME_GRACE_DAYS` days after
a close that exited 0, and sends an `idle-volume` notice for an open task with no run for 7 days. The `tenbox close` in the box fetches the task branch itself, so a PR head pushed from the
box is found at the close on your computer. The line between the two repositories: what is
inside the box (this image) belongs to Tenbox; where and how the box runs (the cluster, the
Job, the volume) belongs to [Tenyard](https://github.com/enojen/tenyard). See [`machines/README.md`](../machines/README.md).

## Roadmap

1. **Done**: roles, `/tenbox-plan`, `/tenbox-build` with Build, Checks and Review,
   `tenbox start`, `check`, `install`.
2. **Done**: `tenbox close`, `tenbox pr`, `tenbox merge-check`, `/tenbox-close`, the ClickUp
   adapter.
3. **Now**: machines. The box image and the login sync are built, and `tenbox machine run`
   starts a task's commands as Jobs on the cluster: `start`, `build`, `close`, `approve`,
   `decide`, `answer`, `check`, `pr`, `status` and `plan show`.
4. Later, see [`docs/design.md`](design.md): the full manifest and the sandbox, the
   Try phase with QA, fakes from API docs, the live pane, the panel.
